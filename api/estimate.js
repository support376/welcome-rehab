// STEP 1 quick estimation
// Spec: welcome_rehab_diagnostic_spec.md §2, §3, 부록 A

const BASE_LIVING_COST = {
  1: 1538543,
  2: 2519575,
  3: 3215422,
  4: 3896843,
  5: 4534031,
  6: 5133571,
};

const INCOME_MID = {
  'u200': 1500000,
  '200_300': 2500000,
  '300_400': 3500000,
  '400_500': 4500000,
  '500_700': 6000000,
  '700p': 8000000,
};

const DEBT_UNSECURED_MID = {
  'none': 0,
  'u3000': 15000000,
  '3000_5000': 40000000,
  '5000_10000': 75000000,
  '10000_30000': 200000000,
  '30000p': 400000000,
};

const DEBT_SECURED_MID = {
  'none': 0,
  'u5000': 30000000,
  '5000_10000': 75000000,
  '10000_30000': 200000000,
  '30000p': 400000000,
};

const DEBT_TAX_MID = {
  'none': 0,
  'u500': 3000000,
  '500_3000': 17500000,
  '3000p': 50000000,
};

const HOT_STATES = new Set(['lawsuit', 'court']);

function roundToManwon(n) {
  return Math.round(n / 10000);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    region,
    household,
    income,
    unsecured,
    secured,
    tax,
    delinquency,
  } = req.body || {};

  const hh = clamp(parseInt(household, 10) || 1, 1, 6);
  const baseLiving = BASE_LIVING_COST[hh];
  const monthlyIncome = INCOME_MID[income] || 0;
  const unsecuredDebt = DEBT_UNSECURED_MID[unsecured] || 0;
  const securedDebt = DEBT_SECURED_MID[secured] || 0;
  const taxDebt = DEBT_TAX_MID[tax] || 0;

  const availableIncome = Math.max(monthlyIncome - baseLiving, 0);
  const repayment36m = availableIncome * 36;

  let dischargeRate = 0;
  if (unsecuredDebt > 0) {
    dischargeRate = ((unsecuredDebt - repayment36m) / unsecuredDebt) * 100;
    dischargeRate = clamp(dischargeRate, 0, 95);
  }

  const monthlyMin = Math.round(availableIncome * 0.8);
  const monthlyMax = availableIncome;
  const rateMin = clamp(dischargeRate - 10, 0, 95);
  const rateMax = clamp(dischargeRate + 10, 0, 95);

  const isHot = HOT_STATES.has(delinquency);

  return res.status(200).json({
    inputs: {
      region,
      household: hh,
      monthly_income: monthlyIncome,
      unsecured: unsecuredDebt,
      secured: securedDebt,
      tax: taxDebt,
      delinquency,
    },
    calc: {
      base_living_cost: baseLiving,
      available_income: availableIncome,
    },
    result: {
      monthly_repayment_min_manwon: roundToManwon(monthlyMin),
      monthly_repayment_max_manwon: roundToManwon(monthlyMax),
      discharge_rate_min: Math.round(rateMin),
      discharge_rate_max: Math.round(rateMax),
      period_months: 36,
      is_hot: isHot,
    },
  });
}

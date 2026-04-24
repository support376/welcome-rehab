// STEP 1 quick estimation — v2
// Spec: welcome_rehab_diagnostic_spec.md §2 (변제금 3원칙: 가용소득 · 청산가치 · 최저변제액)
//
// Backward compatible with the old 7-field payload from tap.html v1.
// When new fields (housing_cost / children_minor / medical_cost / job_type /
// real_estate / financial_assets / history_rehab) are absent, they degrade to 0/none
// and the response shape stays the same.

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
  // 세분화된 브래킷 (v1·v2 공용)
  'u1000':        6000000,    // 1,000만 이하 → 중간값 600만
  '1000_2000':    15000000,   // 1,500만
  '2000_3000':    25000000,   // 2,500만
  '3000_5000':    40000000,   // 4,000만
  '5000_7000':    60000000,   // 6,000만
  '7000_10000':   85000000,   // 8,500만
  '10000_15000':  125000000,  // 1.25억
  '15000_30000':  225000000,  // 2.25억
  '30000p':       400000000,  // 4억
  // 하위호환 (구 브래킷)
  'u3000':        15000000,
  '5000_10000':   75000000,
  '10000_30000':  200000000,
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

// ───── v2 신규 매핑 ─────

// 월 주거비 (월세 / 주담대 이자 / 전세대출 이자 등 합계, 구간 중간값)
const HOUSING_COST_MID = {
  'none':   0,
  'u30':    200000,
  '30_50':  400000,
  '50_80':  650000,
  '80_120': 1000000,
  '120p':   1500000,
};

// 서울회생법원 추가주거비 권역별 한도 (2024~2026 실무 대략치, 운영 시 매년 갱신 필요)
const HOUSING_LIMIT_BY_REGION = {
  '1': 700000,  // 1권역 · 서울
  '2': 600000,  // 2권역 · 수도권 과밀억제 + 세종·용인·화성
  '3': 450000,  // 3권역 · 광역시
  '4': 350000,  // 4권역 · 그 외
};

const MEDICAL_COST_MID = {
  'none':  0,
  'u10':   50000,
  '10_30': 200000,
  '30p':   500000,
};

const EDUCATION_PER_CHILD = 200000; // 미성년 자녀 1인당 월 20만원 인정

const REAL_ESTATE_MID = {
  'none':     0,
  'u100m':    80000000,    // 1억 미만 → 시가 중간값 8,000만
  '100_300m': 200000000,   // 1~3억 → 2억
  '300_500m': 400000000,   // 3~5억 → 4억
  '500mp':    700000000,   // 5억+ → 7억
};

// 금융자산 총액 (예적금 + 보험해약환급금 + 주식·코인 + 퇴직금 예상액 합산, 만원 기준 아님)
const FINANCIAL_MID = {
  'u500':       2500000,   // 500만 미만 → 250만
  '500_1000':   7500000,   // 500~1천 → 750만
  '1000_3000':  20000000,  // 1천~3천 → 2,000만
  '3000p':      45000000,  // 3천+ → 4,500만
};

// 면제재산: 예적금 250만 + 보험 250만 합계 500만 공제
const EXEMPT_FINANCIAL = 5000000;

// 부동산 청산가치 환산: 1차 추정에서는 근저당을 모르므로 시가의 50%를 청산가치로 보수 산입
// (실제 전략은 AI 대화에서 근저당·세입자 보증금 등 확인 후 정밀화)
const REAL_ESTATE_LIQUIDATION_RATIO = 0.5;

const PRO_JOB_TYPES = new Set(['professional', 'corporate']);
const HOT_STATES = new Set(['lawsuit', 'court']);

// 최저 월 변제액 플로어 — 가용소득이 0이어도 법원 실무상 최저 변제액이 결정되는 경우가 많아
// 0원으로 표시하지 않고 이 하한을 노출해 오해를 방지
const MONTHLY_FLOOR_MIN = 100000; // 10만원
const MONTHLY_FLOOR_MAX = 200000; // 20만원

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
    // v1 필드
    region,
    household,
    income,
    unsecured,
    secured,
    tax,
    delinquency,
    // v2 신규 필드 (없으면 기본값)
    housing_cost,
    children_minor,
    medical_cost,
    job_type,
    real_estate,
    financial_assets,
    history_rehab,
  } = req.body || {};

  const hh = clamp(parseInt(household, 10) || 1, 1, 6);
  const baseLiving = BASE_LIVING_COST[hh];
  const monthlyIncome = INCOME_MID[income] || 0;
  const unsecuredDebt = DEBT_UNSECURED_MID[unsecured] || 0;
  const securedDebt = DEBT_SECURED_MID[secured] || 0;
  const taxDebt = DEBT_TAX_MID[tax] || 0;

  // ── 추가생계비 산정 ──
  const housingRaw = HOUSING_COST_MID[housing_cost] || 0;
  const housingLimit = HOUSING_LIMIT_BY_REGION[String(region)] || HOUSING_LIMIT_BY_REGION['4'];
  const housingExtra = Math.min(housingRaw, housingLimit);

  const childCount = clamp(parseInt(children_minor, 10) || 0, 0, 5);
  const educationExtra = childCount * EDUCATION_PER_CHILD;

  const medicalExtra = MEDICAL_COST_MID[medical_cost] || 0;

  const additionalLiving = housingExtra + educationExtra + medicalExtra;

  // ── 가용소득 ──
  const availableIncome = Math.max(monthlyIncome - baseLiving - additionalLiving, 0);

  // ── 청산가치 (재산 − 면제재산) ──
  const realEstateVal = REAL_ESTATE_MID[real_estate] || 0;
  const realEstateLiquidation = Math.floor(realEstateVal * REAL_ESTATE_LIQUIDATION_RATIO);
  const financialVal = FINANCIAL_MID[financial_assets] || 0;
  const financialLiquidation = Math.max(financialVal - EXEMPT_FINANCIAL, 0);
  const liquidationValue = realEstateLiquidation + financialLiquidation;

  // ── 변제금 3원칙 (가용소득×36 vs 청산가치 중 큰 값) ──
  const repayment36m = availableIncome * 36;
  const useLiquidation = liquidationValue > repayment36m;
  let periodMonths;
  let monthlyBase;
  if (useLiquidation) {
    // 청산가치가 더 큼 → 60개월 분할
    periodMonths = 60;
    monthlyBase = Math.ceil(liquidationValue / 60);
  } else {
    periodMonths = 36;
    monthlyBase = availableIncome;
  }

  // 범위 표시 (하한은 20% 할인, 상한은 그대로)
  let monthlyMin = Math.round(monthlyBase * 0.8);
  let monthlyMax = monthlyBase;

  // 최저 플로어 적용
  if (monthlyMax < MONTHLY_FLOOR_MAX) {
    monthlyMin = Math.max(monthlyMin, MONTHLY_FLOOR_MIN);
    monthlyMax = Math.max(monthlyMax, MONTHLY_FLOOR_MAX);
  }
  if (monthlyMin > monthlyMax) monthlyMin = monthlyMax;

  // ── 탕감률 ──
  // 총 변제금 = 월 변제 × 기간 (단, 청산가치 보장 원칙 충족)
  const effectiveMonthly = (monthlyMin + monthlyMax) / 2;
  const effectiveTotal = Math.max(effectiveMonthly * periodMonths, liquidationValue);

  let dischargeRate = 0;
  if (unsecuredDebt > 0) {
    dischargeRate = ((unsecuredDebt - effectiveTotal) / unsecuredDebt) * 100;
    dischargeRate = clamp(dischargeRate, 0, 95);
  }
  const rateMin = clamp(dischargeRate - 10, 0, 95);
  const rateMax = clamp(dischargeRate + 10, 0, 95);

  // ── 케이스 분류 (Lite / Pro / HOT) ──
  const isHot = HOT_STATES.has(delinquency);

  const proTriggers = [];
  if (PRO_JOB_TYPES.has(job_type)) proTriggers.push('직업군(전문직/법인대표)');
  if (unsecuredDebt >= 100000000) proTriggers.push('무담보 채무 1억+');
  if (realEstateVal > 0) proTriggers.push('부동산 보유');
  if (history_rehab && history_rehab !== 'none') proTriggers.push('회생·파산 이력');
  if (job_type === 'self_employed') proTriggers.push('자영업');
  if (taxDebt >= 30000000) proTriggers.push('세금 체납 큰 규모');

  const caseClassification = proTriggers.length > 0 ? 'pro' : 'lite';

  return res.status(200).json({
    inputs: {
      region,
      household: hh,
      monthly_income: monthlyIncome,
      unsecured: unsecuredDebt,
      secured: securedDebt,
      tax: taxDebt,
      delinquency,
      housing_cost: housingRaw,
      children_minor: childCount,
      medical_cost: medicalExtra,
      job_type: job_type || null,
      real_estate: realEstateVal,
      financial_assets: financialVal,
      history_rehab: history_rehab || 'none',
    },
    calc: {
      base_living_cost: baseLiving,
      housing_extra: housingExtra,
      housing_limit: housingLimit,
      education_extra: educationExtra,
      medical_extra: medicalExtra,
      additional_living: additionalLiving,
      available_income: availableIncome,
      repayment_36m: repayment36m,
      real_estate_liquidation: realEstateLiquidation,
      financial_liquidation: financialLiquidation,
      liquidation_value: liquidationValue,
      use_liquidation_basis: useLiquidation,
    },
    result: {
      monthly_repayment_min_manwon: roundToManwon(monthlyMin),
      monthly_repayment_max_manwon: roundToManwon(monthlyMax),
      discharge_rate_min: Math.round(rateMin),
      discharge_rate_max: Math.round(rateMax),
      period_months: periodMonths,
      is_hot: isHot,
      case_classification: caseClassification,
      pro_triggers: proTriggers,
    },
  });
}
// test comment Fri Apr 24 07:42:54 UTC 2026

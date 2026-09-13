type MeasurementDimension = 'volume' | 'mass';

type MeasurementUnit = 'ml' | 'l' | 'fl_oz' | 'g' | 'kg' | 'oz' | 'lb';

interface MeasurementUnitDefinition {
  dimension: MeasurementDimension;
  baseFactor: number;
  label: string;
}

interface ParsedMeasurement {
  amount: number;
  unit: MeasurementUnit;
  dimension: MeasurementDimension;
  baseAmount: number;
}

export interface ParsedPortion {
  fraction: number;
  display: string;
  kind: 'ratio' | 'measurement';
}

export type PortionParseResult =
  | { ok: true; value: ParsedPortion }
  | { ok: false; error: string };

const KNOWN_FRACTIONS = [
  { label: '7/8', value: 7 / 8 },
  { label: '3/4', value: 3 / 4 },
  { label: '2/3', value: 2 / 3 },
  { label: '1/2', value: 1 / 2 },
  { label: '1/3', value: 1 / 3 },
  { label: '1/4', value: 1 / 4 },
  { label: '1/8', value: 1 / 8 },
];

const MEASUREMENT_UNITS: Record<MeasurementUnit, MeasurementUnitDefinition> = {
  ml: { dimension: 'volume', baseFactor: 1, label: 'ml' },
  l: { dimension: 'volume', baseFactor: 1000, label: 'L' },
  fl_oz: { dimension: 'volume', baseFactor: 29.5735295625, label: 'fl oz' },
  g: { dimension: 'mass', baseFactor: 1, label: 'g' },
  kg: { dimension: 'mass', baseFactor: 1000, label: 'kg' },
  oz: { dimension: 'mass', baseFactor: 28.349523125, label: 'oz' },
  lb: { dimension: 'mass', baseFactor: 453.59237, label: 'lb' },
};

const UNIT_ALIASES: Record<string, MeasurementUnit> = {
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  毫升: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  升: 'l',
  'fl oz': 'fl_oz',
  floz: 'fl_oz',
  'fluid ounce': 'fl_oz',
  'fluid ounces': 'fl_oz',
  液体盎司: 'fl_oz',
  g: 'g',
  gram: 'g',
  grams: 'g',
  克: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  千克: 'kg',
  公斤: 'kg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  盎司: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  磅: 'lb',
};

const tidyNumber = (value: number, maximumFractionDigits = 2): string => new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits,
  useGrouping: false,
}).format(value);

const parseRatio = (raw: string): number | null => {
  const value = raw.trim();
  if (!value) return null;

  if (value.endsWith('%')) {
    const percent = Number(value.slice(0, -1).trim());
    return Number.isFinite(percent) ? percent / 100 : null;
  }

  const fraction = value.match(/^(\d+(?:\.\d+)?|\.\d+)\s*\/\s*(\d+(?:\.\d+)?|\.\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator > 0 ? Number(fraction[1]) / denominator : null;
  }

  const decimal = Number(value);
  return Number.isFinite(decimal) ? decimal : null;
};

const parseMeasurement = (raw: string): ParsedMeasurement | null => {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?|\.\d+)\s*(.+)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const rawUnit = match[2].trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const unit = UNIT_ALIASES[rawUnit];
  if (!unit || !Number.isFinite(amount) || amount < 0) return null;

  const definition = MEASUREMENT_UNITS[unit];
  return {
    amount,
    unit,
    dimension: definition.dimension,
    baseAmount: amount * definition.baseFactor,
  };
};

const measurementLabel = (measurement: ParsedMeasurement): string =>
  `${tidyNumber(measurement.amount, 3)} ${MEASUREMENT_UNITS[measurement.unit].label}`;

export const formatPortionFraction = (value: number): string => {
  const known = [
    ...KNOWN_FRACTIONS,
    { label: '满', value: 1 },
  ].find(item => Math.abs(item.value - value) < 0.000001);
  return known?.label ?? `${tidyNumber(value * 100, 1)}%`;
};

export const formatPortionInput = (value: number): string => {
  const known = KNOWN_FRACTIONS.find(item => Math.abs(item.value - value) < 0.000001);
  if (known) return known.label;
  if (value === 1) return '1';
  return String(Number(value.toPrecision(12)));
};

export const parsePortionInput = (raw: string, packageSize?: string): PortionParseResult => {
  const ratio = parseRatio(raw);
  if (ratio !== null) {
    if (ratio < 0 || ratio > 1) {
      return { ok: false, error: '比例要在 0 到 1 之间，例如 1/3 或 20%' };
    }
    return {
      ok: true,
      value: { fraction: ratio, display: formatPortionFraction(ratio), kind: 'ratio' },
    };
  }

  const amount = parseMeasurement(raw);
  if (!amount) {
    return { ok: false, error: '请填写分数、百分比或实际用量，例如 1/3、20% 或 250 ml' };
  }

  if (!packageSize?.trim()) {
    return { ok: false, error: '要按 ml、g 等实际单位记录，需要先填写每件包装规格' };
  }

  const packageMeasurement = parseMeasurement(packageSize);
  if (!packageMeasurement) {
    return { ok: false, error: `包装规格“${packageSize}”暂时无法换算，请改用分数或百分比` };
  }
  if (packageMeasurement.amount === 0) {
    return { ok: false, error: '每件包装规格必须大于 0' };
  }

  if (amount.dimension !== packageMeasurement.dimension) {
    const hint = packageMeasurement.unit === 'oz' && amount.dimension === 'volume'
      ? '；如果包装上的 oz 指容量，请把规格写成 fl oz'
      : '';
    return { ok: false, error: `填写的用量和包装规格不是同一类单位${hint}` };
  }

  const fraction = amount.baseAmount / packageMeasurement.baseAmount;
  if (fraction > 1 + 0.000001) {
    return { ok: false, error: `填写的 ${measurementLabel(amount)} 超过了一整件包装` };
  }

  return {
    ok: true,
    value: {
      fraction: Math.min(1, fraction),
      display: measurementLabel(amount),
      kind: 'measurement',
    },
  };
};

export const formatPackageAmount = (packageSize: string | undefined, fraction: number): string | null => {
  if (!packageSize || !Number.isFinite(fraction) || fraction < 0) return null;
  const measurement = parseMeasurement(packageSize);
  if (!measurement) return null;

  const baseAmount = measurement.baseAmount * fraction;
  if (measurement.unit === 'l' && baseAmount < 1000) return `${tidyNumber(baseAmount, 0)} ml`;
  if (measurement.unit === 'kg' && baseAmount < 1000) return `${tidyNumber(baseAmount, 0)} g`;

  const amount = baseAmount / MEASUREMENT_UNITS[measurement.unit].baseFactor;
  return `${tidyNumber(amount, amount < 10 ? 2 : 1)} ${MEASUREMENT_UNITS[measurement.unit].label}`;
};

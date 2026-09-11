export const absBigInt = (value: bigint): bigint => (value < 0n ? -value : value);

export const ceilDiv = (numerator: bigint, denominator: bigint): bigint => {
  if (numerator < 0n || denominator <= 0n) throw new RangeError("ceilDiv 只接受非负分子和正分母");
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
};

export const bigintSqrt = (value: bigint): bigint => {
  if (value < 0n) throw new RangeError("负数没有整数平方根");
  if (value < 2n) return value;
  let x0 = 1n << (BigInt(value.toString(2).length) >> 1n);
  let x1 = (x0 + value / x0) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }
  return x0;
};

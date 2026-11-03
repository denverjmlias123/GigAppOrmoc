/**
 * GigOrmoc Currency Utility Module
 * All monetary calculations inside GigOrmoc operate on integer centavos (safe numbers)
 * to avoid IEEE 754 floating-point rounding errors and avoid BigInt JSON serialization failures.
 */

/**
 * Parses a user-input PHP currency string into integer centavos.
 * Accepts formats like: "500", "500.00", "₱500.50", "PHP 1,250.75", "1,250"
 * Returns null if the input is negative, non-numeric, or exceeds safe integer bounds.
 */
export function parsePhpToCentavos(input: string): number | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Strip currency symbols, commas, and whitespace
  const sanitized = input.replace(/[₱\s,]|PHP/gi, '').trim();
  if (sanitized === '') {
    return null;
  }

  // Ensure valid decimal format with at most two decimal digits
  const decimalRegex = /^\d+(\.\d{1,2})?$/;
  if (!decimalRegex.test(sanitized)) {
    return null;
  }

  const floatVal = parseFloat(sanitized);
  if (isNaN(floatVal) || floatVal <= 0) {
    return null;
  }

  // Convert to integer centavos
  const centavos = Math.round(floatVal * 100);
  if (!Number.isSafeInteger(centavos) || centavos <= 0) {
    return null;
  }

  return centavos;
}

/**
 * Formats integer centavos into a human-readable Philippine Peso string.
 * Example: 500000 -> "₱5,000.00"
 */
export function formatCentavosToPhp(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) {
    return '₱0.00';
  }

  const pesos = centavos / 100;
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pesos);
}

/**
 * Validates that an array of milestone centavos sums exactly to the contract total centavos.
 * Returns whether the sum matches, along with the delta (sum - total).
 */
export function validateMilestoneSum(
  milestoneCentavos: number[],
  contractTotalCentavos: number
): { valid: boolean; deltaCentavos: number; totalMilestones: number } {
  if (!Array.isArray(milestoneCentavos) || milestoneCentavos.length === 0) {
    return {
      valid: false,
      deltaCentavos: -contractTotalCentavos,
      totalMilestones: 0,
    };
  }

  let totalMilestones = 0;
  for (const amt of milestoneCentavos) {
    if (!Number.isSafeInteger(amt) || amt <= 0) {
      return {
        valid: false,
        deltaCentavos: -contractTotalCentavos,
        totalMilestones: 0,
      };
    }
    totalMilestones += amt;
  }

  const deltaCentavos = totalMilestones - contractTotalCentavos;
  return {
    valid: deltaCentavos === 0,
    deltaCentavos,
    totalMilestones,
  };
}

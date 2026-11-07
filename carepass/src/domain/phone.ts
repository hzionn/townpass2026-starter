export function cleanPhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function isDialablePhone(phone: string): boolean {
  return /^(?:1966|0\d{8,9}|\+886\d{8,9})$/.test(cleanPhone(phone));
}

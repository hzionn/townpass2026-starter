export type IconName = 'heart' | 'home' | 'arrow' | 'back' | 'check' | 'phone' | 'pin' | 'list' | 'clock' | 'external' | 'info' | 'copy' | 'trash' | 'chevron' | 'spark';
const paths: Record<IconName, string> = {
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6', back: 'M20 12H4m6-6-6 6 6 6', check: 'm5 12 4 4L19 6',
  phone: 'M5 3h4l2 5-3 2a16 16 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
  list: 'M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1', clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  external: 'M14 3h7v7m0-7L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6',
  info: 'M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  copy: 'M9 9h12v12H9ZM15 9V3H3v12h6', trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  chevron: 'm9 5 7 7-7 7', spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',
};
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function CareIllustration() {
  return <svg className="care-illustration" viewBox="0 0 260 230" fill="none" aria-hidden="true">
    <circle cx="130" cy="114" r="94" fill="var(--tp-primary-100)" />
    <path d="M54 171c-10-30-25-43-28-64 25 9 39 32 36 56M204 173c1-23 23-41 35-44-2 22-11 41-35 44" fill="var(--tp-primary-300)" />
    <path d="M66 74 130 25l64 49v104H66V74Z" fill="var(--tp-white)" stroke="var(--tp-primary-700)" strokeWidth="3" strokeLinejoin="round" />
    <path d="m51 84 79-62 79 62" stroke="var(--tp-primary-700)" strokeWidth="6" strokeLinecap="round" />
    <path d="M151 94c-8-8-17-6-21 0-5-6-14-8-22 0-9 10-1 21 22 37 23-16 30-27 21-37Z" fill="var(--tp-secondary-500)" />
    <path d="M26 161c19-12 32-10 49 0l27 13h48c10 0 13 13 2 17l-31 7-32-7" fill="var(--tp-primary-200)" stroke="var(--tp-primary-700)" strokeWidth="3" strokeLinecap="round" />
    <path d="m238 158-32-4-55 20h-49c-12 0-12 14 0 17l35 10 39-8 62-17" fill="var(--tp-primary-100)" stroke="var(--tp-primary-700)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m19 152 21-2 14 51-22 5M240 150l-18-3-14 51 24 8" fill="var(--tp-primary-500)" stroke="var(--tp-primary-700)" strokeWidth="3" />
    <path d="m210 41 3-8 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="var(--tp-secondary-500)" />
    <circle cx="42" cy="48" r="5" fill="var(--tp-secondary-500)" />
  </svg>;
}

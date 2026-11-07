/** Shown in document.title, which is also what TownPass's app bar displays. */
export function pageTitle(title: string | undefined): string {
  return title ? `託你辦｜${title}` : '託你辦';
}

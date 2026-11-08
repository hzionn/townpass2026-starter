import { describe, expect, it } from 'vitest';
import { buildAssistLink, parseAssistLink, tokenFromFragment } from './assistLink.js';

const ORIGIN = 'https://tuoniban.example';
const TOKEN = 'a'.repeat(43);
const LINK = `${ORIGIN}/assist#token=${TOKEN}`;

describe('buildAssistLink', () => {
  it('round-trips through the parser', () => {
    expect(parseAssistLink(buildAssistLink(ORIGIN, TOKEN), ORIGIN)).toEqual({ ok: true, token: TOKEN });
  });
});

describe('parseAssistLink', () => {
  it('accepts a valid link, tolerating pasted whitespace', () => {
    expect(parseAssistLink(`  ${LINK}\n`, ORIGIN)).toEqual({ ok: true, token: TOKEN });
  });

  // AT05 and spec §4.2: nothing here may be navigated to or sent to the backend.
  it.each([
    ['null scan result', null],
    ['undefined', undefined],
    ['a number', 42],
    ['empty text', ''],
    ['whitespace', '   '],
    ['a bare token', TOKEN],
    ['random text', 'hello'],
    ['another site', `https://evil.example/assist#token=${TOKEN}`],
    ['look-alike origin', `${ORIGIN}.evil.example/assist#token=${TOKEN}`],
    ['origin in userinfo', `https://tuoniban.example@evil.example/assist#token=${TOKEN}`],
    ['credentials', `https://user:pw@tuoniban.example/assist#token=${TOKEN}`],
    ['http downgrade', `http://tuoniban.example/assist#token=${TOKEN}`],
    ['wrong path', `${ORIGIN}/other#token=${TOKEN}`],
    ['trailing slash', `${ORIGIN}/assist/#token=${TOKEN}`],
    ['query string', `${ORIGIN}/assist?x=1#token=${TOKEN}`],
    ['token in query', `${ORIGIN}/assist?token=${TOKEN}`],
    ['no fragment', `${ORIGIN}/assist`],
    ['no token', `${ORIGIN}/assist#token=`],
    ['short token', `${ORIGIN}/assist#token=abc`],
    ['long token', `${ORIGIN}/assist#token=${'a'.repeat(44)}`],
    ['bad characters', `${ORIGIN}/assist#token=${'!'.repeat(43)}`],
    ['second parameter', `${ORIGIN}/assist#token=${TOKEN}&x=1`],
    ['duplicate token', `${ORIGIN}/assist#token=${TOKEN}&token=${TOKEN}`],
    ['javascript url', `javascript:alert(1)//${ORIGIN}/assist#token=${TOKEN}`],
    ['oversized input', `${LINK}${'a'.repeat(600)}`],
  ])('rejects %s', (_name, input) => {
    expect(parseAssistLink(input, ORIGIN)).toEqual({ ok: false });
  });
});

describe('tokenFromFragment', () => {
  it('reads a valid fragment', () => {
    expect(tokenFromFragment(`#token=${TOKEN}`)).toBe(TOKEN);
  });

  it.each(['', '#', '#token=', `#foo=${TOKEN}`, `#token=${TOKEN}&a=b`, '#token=short'])('rejects %s', (fragment) => {
    expect(tokenFromFragment(fragment)).toBeNull();
  });
});

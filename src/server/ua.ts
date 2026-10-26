// Deliberately small user-agent parser: enough to group sessions by browser and OS.

const BROWSERS: Array<[string, RegExp]> = [
  ['Edge', /Edg(?:e|A|iOS)?\//],
  ['Opera', /OPR\/|Opera/],
  ['Samsung Internet', /SamsungBrowser\//],
  ['Firefox', /Firefox\/|FxiOS\//],
  ['Chrome', /Chrome\/|CriOS\//],
  ['Safari', /Version\/[\d.]+.*Safari\//],
];

const OSES: Array<[string, RegExp]> = [
  ['iOS', /iPhone|iPad|iPod/],
  ['Android', /Android/],
  ['Windows', /Windows/],
  ['ChromeOS', /CrOS/],
  ['macOS', /Mac OS X|Macintosh/],
  ['Linux', /Linux/],
];

export function parseUserAgent(ua: string): { browser: string; os: string; bot: boolean } {
  const bot = /bot|crawler|spider|crawling|headlesschrome|lighthouse|pingdom|gtmetrix/i.test(ua);
  const browser = BROWSERS.find(([, re]) => re.test(ua))?.[0] ?? 'Other';
  const os = OSES.find(([, re]) => re.test(ua))?.[0] ?? 'Other';
  return { browser, os, bot };
}

import { openBrowser } from '../../src/browser.js';
const { context, page } = await openBrowser();
await page.goto('about:blank');
const info = await page.evaluate(() => ({
  webdriver: navigator.webdriver,
  langs: navigator.languages,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ua: navigator.userAgent.slice(0, 90),
}));
console.log(JSON.stringify(info, null, 2));
await context.close();

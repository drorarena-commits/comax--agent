/**
 * שליחת הצעת מחיר בדוא"ל.
 *
 * המימוש עצמו יושב ב-[`document-email.js`](document-email.js) ומשרת את כל סוגי
 * המסמכים — מסך המעטפה (`Erp/Divor_Doc.asp`) משותף לכולם, ורק תוכנית הרשימה
 * שונה. הקובץ הזה נשאר כדי ש-`node tools/run.js quote-email` ימשיך לעבוד כפי
 * שהוא, ולא כדי להחזיק עותק שני של אותה זרימה: שכפול של זרימת שליחה הוא בדיוק
 * המקום שבו הגנת הנמען (כלל 14) הייתה מתפצלת ואחד העותקים היה נשאר מאחור.
 */
import { meta as generalMeta, run as sendDocument } from './document-email.js';

export const meta = {
  ...generalMeta,
  name: 'quote-email',
  description: 'שליחת הצעת מחיר בדוא"ל דרך קומקס',
  input: Object.fromEntries(Object.entries(generalMeta.input).filter(([k]) => k !== 'document')),
};

export async function run(ctx) {
  return sendDocument({ ...ctx, input: { ...ctx.input, document: 'quote' } });
}

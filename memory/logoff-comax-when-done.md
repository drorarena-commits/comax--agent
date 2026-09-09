---
name: logoff-comax-when-done
description: בסוף כל זרימת מסמך — לסגור תוכניות, npm run logoff, ולסגור את חלון הכרום של הסוכן
metadata:
  type: feedback
---

בסוף כל עבודה בקומקס: לוודא שהמסמכים נקלטו, `npm run close -- all`,
`npm run logoff`, **ואז לסגור ממש את חלון הכרום של הסוכן**.

**Why:** לקוד המשתמש בקומקס יש מושב אחד. כל עוד הסשן פתוח אף אחד אחר בעסק לא
יכול להיכנס — "קוד משתמש בשימוש". סגירת החלון לבדה לא מספיקה, השרת ממשיך להחזיק
את המושב כמה דקות; `logoff` שולח `CloseSession` ומשחרר אותו מיד.

**How to apply:** לסגור רק כרום שרץ על `user-data-dir=C:\AGENT-COMAX-CLOAD\.chrome-profile`
— לא הכרום הפרטי. `npm run close -- all` ולא `npm run close` (בלי `all` הוא רק מציג).

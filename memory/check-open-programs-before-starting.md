---
name: check-open-programs-before-starting
description: לפני כל זרימת מסמך בקומקס — לבדוק מה פתוח בפאנל "תוכניות בעבודה" ולסגור שאריות
metadata:
  type: feedback
---

בקומקס, לפני שמתחילים זרימת מסמך: ללחוץ על כפתור **שני החצים המעוגלים** בסרגל התחתון
(`#Run`) כדי לראות אילו תוכניות/מסמכים פתוחים ברקע, ולסגור שאריות — `npm run close -- list`
ואז `npm run close -- <שם>` או `all`.

**Why:** דרור הצביע על הכפתור אחרי ש-`quote-new` נערם מתחת לחלון "מטריצת מחסנים" שנשאר
פתוח מהרצה קודמת. הידע על הפאנל כבר תועד ב-`knowledge/MAP.md`, אבל לא הופעל בפועל:
`quote-new` / `quote-add-line` / `quote-finalize` לא מריצים `closePrograms` בהתחלה,
בניגוד למשימת `document`. חלון פתוח גם בולע את הדאבל-קליק של המשימה הבאה.

**How to apply:** להריץ `npm run close -- list` לפני המסמך הראשון בסשן ולסגור מה שלא שייך,
ולסגור בסוף. **לא** לסגור באמצע זרימה כשמסמך פתוח על המסך — הפאנל עלול לקחת את המסמך
העובד איתו. קשור ל-[[identify-items-by-sku-not-barcode]] ול-[[stock-from-local-export]].

# Axis Studio — WebGL / Model Studio

**الموقع:** Model Studio (Vite + Three.js)  
**آخر نسخة من النموذج:** `public/models/1 A TEST V2.glb`  
**المسار:** `D:\Axis Studio\webgl`

---

## 1. البنية / Structure

```
D:\Axis Studio\webgl\
├── index.html                  واجهة Model Studio
├── package.json                الأوامر والاعتماديات
├── package-lock.json
├── vite.config.js
├── serve-viewer.cjs             عارض ثلاثي الأبعاد مستقل (منفذ 8015)
├── src\
│   ├── main.js                 الواجهة، التحميل، التصدير، زر Latest
│   ├── viewer.js               Three.js renderer / camera / lights
│   ├── model.js                تحميل GLB وتجهيز الخامات
│   ├── bake.js                 طبخ الإضاءة (Vertex bake)
│   ├── hotspots.js             الهوت سبوت والماركرات
│   ├── meshopt-export.js       ضغط Meshopt عند التصدير
│   ├── zip.js                  إنشاء ZIP
│   └── style.css
├── public\
│   ├── basis\                  فك ترميز KTX2/Basis
│   ├── draco\                  فك ترميز Draco
│   ├── environments\           بيئات HDR جاهزة
│   ├── viewer\                 العارض المستقل (index.html + app.js + sky.hdr)
│   └── models\
│       └── 1 A TEST V2.glb     ← آخر نسخة من النموذج (153.9 MB)
├── docs\
│   ├── FULL-REPORT.md
│   ├── MODEL-STUDIO-REPORT.md
│   ├── SESSION-STATE.md
│   └── HOW-3D-PROJECT-WAS-MADE.md
├── node_modules\               مثبّتة مسبقًا (جاهزة للعمل)
└── .gitignore
```

---

## 2. التشغيل / Run

### Development (الأسرع أثناء التعديل)
```bat
cd /d "D:\Axis Studio\webgl"
npm run dev
```
افتح: <http://127.0.0.1:5173/>

### Production build
```bat
cd /d "D:\Axis Studio\webgl"
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```
افتح: <http://127.0.0.1:4173/>

### من الهاتف على نفس الشبكة
- استخدم IP الجهاز، مثال: `http://192.168.1.19:5173/` (dev) أو `http://192.168.1.19:4173/` (preview).
- تأكد أن جدار الحماية يسمح بالمنفذ.

---

## 3. تحميل آخر نسخة من النموذج

- في لوحة **Model** اضغط زر **Latest** بجانب **Browse**.
- سيتم تحميل `public/models/1 A TEST V2.glb` مباشرة من الموقع مع شريط تقدّم.
- يمكنك أيضًا سحب الملف وإفلاته في الصفحة كالمعتاد.

### مواصفات النموذج
| | |
|---|---|
| الملف | `1 A TEST V2.glb` |
| الحجم | **153.90 MB** (161,372,668 بايت) |
| المثلثات | **3,140,845** |
| الرؤوس | 4,544,278 |
| Meshes / Nodes | 104 / 104 |
| Materials | 94 |
| Textures | 57 (WebP) |
| المُصدِّر | glTF-Transform v4.4.2 |

> النموذج يحتوي على `KHR_materials_anisotropy` بقيمة `1.333` (أكبر من الحد المسموح 1)
> على 80 خامة. تمت معالجة ذلك في `src/model.js` عند التحميل (تصفير anisotropy/sheen/ior)
> حتى لا تظهر أسطح سوداء من زوايا معينة. نفس الإصلاح موجود في عارض Three.js القديم.

**نتيجة التحقق بعد البناء:**
```
3,140,845 triangles · 104 meshes · 94 materials
anisotropy > 0 : 0
sheen > 0      : 0
ior ≠ 1.5      : 0
load time      : ~0.6 s (local)
```

---

## 4. ملاحظات مهمة

- **لا تحذف `node_modules`** إلا إذا أردت إعادة التثبيت بـ `npm install`.
- ملف النموذج داخل `public/models` لأنه يُخدَّم مباشرة في dev ويُنسخ تلقائيًا إلى `dist` عند البناء.
- حجم `dist` سيكون كبيرًا (~160 MB) بسبب النموذج؛ هذا طبيعي.
- عند تعديل `src` أعد تشغيل Vite أو حدّث الصفحة.
- زر **Latest** يضيف النموذج كـ `File` ثم يمر بنفس مسار التحميل والتجهيز العادي.
- تم تعديل `computeFocusBox` في `src/viewer.js` ليطار **المجمع السكني** بدل التضاريس
  الضخمة المحيطة (المجمع ≈ 1.4% من قطر المشهد الكلي).
- تم اختبار النسختين: dev على `5173` وpreview على `4173` — كلاهما يحمّل النموذج ويعرضه.

---

## 5. أوامر سريعة

```bat
cd /d "D:\Axis Studio\webgl"

npm run dev
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

---

## 6. العارض ثلاثي الأبعاد المستقل (بدون Model Studio)

العارض البسيط الذي يحتوي على شريط الشمس أصبح داخل هذا المشروع أيضًا:

```bat
cd /d "D:\Axis Studio\webgl"
node serve-viewer.cjs
```

- العارض: <http://127.0.0.1:8015/viewer/>
- من Vite (تطوير): <http://127.0.0.1:5173/viewer/index.html>
- من النسخة المبنية: <http://127.0.0.1:4173/viewer/>
- المصدر: `public\viewer\` (يستخدم نفس النموذج في `public\models`).

---

## 7. تقارير

- `docs/FULL-REPORT.md` — تقرير شامل لكل مراحل المشروع (Verge3D → GLB → Three.js → V2).
- `docs/MODEL-STUDIO-REPORT.md` — تقرير ميزات Model Studio.
- `docs/SESSION-STATE.md` — حالة الجلسة السابقة والتحسينات.
- `docs/HOW-3D-PROJECT-WAS-MADE.md` — طريقة ضغط المشروع القديم وWebP.

**آخر تحديث:** 2026-11-20

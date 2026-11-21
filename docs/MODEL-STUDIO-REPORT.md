# Model Studio — تقرير التحديث

**التاريخ:** 2026-11-17
**المشروع:** `C:\Users\NEJMA\Downloads\cdn.soft8soft.com\model-studio`
**التشغيل:** `http://127.0.0.1:5173/`
**المكدس:** Vite + Three.js r187 + GLTFExporter

---

## 1. ملخص ما تم إنجازه

| # | الميزة | الحالة |
|---|---|---|
| 1 | إصلاح اختفاء الأزرار/البطاقات عند إعادة بناء الواجهة | تم |
| 2 | انتقاء الخامات من المجسم بالقطارة (Eyedropper) | تم |
| 3 | زر **Bake** لطبخ الخامات والإضاءة قبل الإكسبورد | تم |
| 4 | معاينة الناتج المخبوز قبل التصدير + زر Restore | تم |
| 5 | إضافة صورة للهوت سبوت + أنيميشن Hover | تم |
| 6 | إظهار الاسم الكامل للهوت سبوت عند المرور بالماوس | تم |
| 7 | إكسبورد المشروع كاملًا: GLB / glTF / ZIP | تم |
| 8 | تضمين الهوت سبوت والإعدادات داخل الملف المُصدَّر | تم |
| 9 | اختيار حجم الخامات الأقصى عند التصدير | تم |

---

## 2. إصلاح مشكلة اختفاء الأزرار

### السبب
عند إعادة بناء تبويبات **Materials** أو **Hotspots** (Copy to all / Reset / تغيير الأكشن / إضافة أو حذف) كانت جميع البطاقات تُغلق وتُعاد فارغة، فتختفي أزرارها من أمام المستخدم.

### الحل
- `buildMaterialsUI()` في `src/main.js` يحفظ الآن:
  - معرّفات البطاقات المفتوحة (`details[open]`).
  - موضع التمرير في `.panel-scroll`.
- `renderHotspotEditor()` يحفظ نفس الشيء.
- أضيف `card.dataset.matId` لتتم المطابقة بعد إعادة البناء.
- عند الضغط على Copy / Reset تبقى البطاقة مفتوحة ولا يختفي باقي المحتوى.

> إذا استمرت المشكلة في تبويب أو زر معيّن، أرسل صورة للشاشة.

---

## 3. انتقاء الخامات (Material Picker)

### مكان الزر
تبويب **Materials** → زر القطارة بجانب مربع البحث (أيقونة قطرة).

### طريقة الاستخدام
1. اضغط زر القطارة (يتحول إلى الوضع النشط).
2. انقر على أي مجسم في المشهد (شجرة، فيلا، أرض…).
3. تظهر بطاقة الخامة الخاصة به في أعلى القائمة مع عنوان **Picked from …**.
4. يظهر حول المجسم وميض BoxHelper أصفر لمدة قصيرة.
5. اضغط `Esc` لإلغاء الوضع.

### التفاصيل التقنية
- `Viewer.pickModelObject(event)` في `src/viewer.js` يلتقط المجسم عبر Raycaster.
- `ModelService.getMaterialEntriesForObject()` في `src/model.js` يرجع مدخلات الخامات.
- يعمل مع الخامات المخبوزة أيضًا عبر `material.userData.sourceMaterialId`.

---

## 4. زر البيك (Bake) لطبخ الخامات والإضاءة

### المكان
تبويب **Export** → قسم **Lighting bake** (قبل قسم التصدير).

### ماذا يفعل
- يجمع اتجاه الشمس ولونها وشدتها، ولون السماء والأرض، وشدة البيئة.
- يحسب لكل رأس (Vertex) لون إضاءة تقريبي ويخزّنه في `geometry.attributes.color`.
- يستبدل الخامات الأصلية بـ `MeshBasicMaterial` (Unlit) مع:
  - نفس `map` (Base Color).
  - نفس اللون والشفافية و`alphaTest` و`side` و`wireframe`.
  - `vertexColors: true`.
- يعطل الظلال و`renderer.shadowMap` أثناء المعاينة.
- **لا يحذف** الخامات الأصلية؛ يمكن التراجع بزر **Restore original materials**.

### النتيجة
- تقليل حساب الإضاءة والظلال في الهاتف/الكمبيوتر.
- ظهور أسرع في عارض Three.js يدعم `KHR_materials_unlit`.
- معاينة قبل التصدير كما طلبت.

### حدود البيك
- البيك هو **لقطة إضاءة** (Vertex Lighting) وليس Lightmap/AO حقيقي.
- الخامات الشفافة/الزجاج تفقد انعكاسات PBR لأنها أصبحت Unlit.
- لا يتم دمج الخامات في Atlas، فقط تُخفَّف الخامة إلى Unlit + ألوان رؤوس.

---

## 5. الهوت سبوت: صورة + أنيميشن + الاسم الكامل

### الإضافات في بطاقة الهوت سبوت
- **Marker image**: رفع صورة/أيقونة (تُقصّ داخل دائرة الماركر مع إطار ملون ورقم صغير).
- **Hover animation**:
  - `None`
  - `Fade in`
  - `Scale up`
  - `Pulse`
- عند مرور الماوس:
  - يظهر **الاسم الكامل** في Tooltip.
  - يدعم العربية والنصوص الطويلة (يلتف على أكثر من سطر).
  - الماركر نفسه يكبر/ينبض حسب الاختيار.

### الحفظ والتصدير
- `icon` و`hoverAnim` يُحفظان في `scene-settings.json` وفي `toJSON()`.
- صورة الأيقونة تُضمَّن داخل GLB كـ Texture للماركر.
- بيانات الهوت سبوت تُضمَّن في `node.extras.hotspot` داخل GLB/glTF.

### ماركرات التصدير
- في النسخة السابقة كانت الماركرات `Sprite` ولا يصدرها `GLTFExporter`.
- الآن يتم إنشاء **Plane Mesh** لكل هوت سبوت:
  - الحجم نسبي لنصف قطر المجسم.
  - يواجه الكاميرا وقت التصدير.
  - `MeshBasicMaterial` شفاف مع خريطة الأيقونة.
  - `userData.hotspot` يحتوي: `id, label, position, color, size, shape, hoverAnim, iconEmbedded, action`.

---

## 6. إكسبورد المشروع كاملًا

### المكان
تبويب **Export** → قسم **Project export**.

### الخيارات
| الخيار | القيم |
|---|---|
| **Format** | `Project bundle (.zip)` — موصى به · `GLB` · `glTF` |
| **Texture max size** | Original · 2048 · 1024 · 512 |
| **Include hotspots & icons** | تشغيل/إيقاف |
| **Export full project** | زر التصدير |

### محتوى الـ ZIP
```
<name>-project.zip
├── <name>.glb
└── scene-settings.json
```

#### ملف GLB يحتوي
- المجسمات المعدّلة.
- الخامات الحالية (أو المخبوزة Unlit).
- ماركرات الهوت سبوت كـ Mesh + `extras.hotspot`.
- `extras.__modelStudio` على العقدة الجذرية مع كل الإعدادات.
- صور WebP (44 من 45 في الاختبار).
- إعدادات `KHR_materials_unlit` عند البيك.

#### ملف scene-settings.json يحتوي
- الكاميرا.
- البيئة (HDRI intensity/background/rotation).
- الشمس (azimuth/elevation/intensity/color/shadows/quality).
- العرض (exposure/tone mapping/render scale/fov/ambient/ground shadow/quality/fog).
- المواد (كل الخامات + overrides).
- الهوت سبوت (label/position/icon/hoverAnim/action).
- الأنيميشن (clip/speed/playing).
- `bakedPreview` و`exportedAt`.

### صيغة glTF مقابل GLB
- **GLB**: ملف واحد مدمج، أسرع وأصغر للنشر.
- **glTF**: JSON + Base64، أسهل للفحص والتعديل اليدوي، لكنه أكبر.
- **ZIP**: يجمع GLB + الإعدادات في ملف واحد (موصى به للمشروع الكامل).

### زر GLB العلوي
- الشريط العلوي → زر **GLB** = تصدير GLB سريع بنفس التعديلات والماركرات.

---

## 7. التحقق والاختبارات

### البناء
```bat
cd C:\Users\NEJMA\Downloads\cdn.soft8soft.com\model-studio
npm run build
```
النتيجة: نجح البناء (29 Modules، ~924 KB JS).

### اختبار المتصفح (Headless Chrome + CDP)
- تحميل `untitled-viewer\model_lite.glb` (9.5 MB / 487k مثلث).
- إضافة هوت سبوت مع صورة وأيقونة.
- اختبار Hover: ظهر `Hotspot 1` + كلاس `anim-scale`.
- اختبار الاسم الكامل العربي: `فيلا النور — المدخل الرئيسي والحديقة` ظهر كاملًا.
- تفعيل البيك:
  - `meshes: 59`
  - `basic: 59`
  - `colored: 59`
  - `shadowMap: false`
  - `sunCast: false`
- اختبار القطارة بعد البيك: نجحت وظهرت بطاقة الخامة.
- التصدير:
  - `GLTF`: 63 Nodes، 60 Materials، 60 Unlit، 1 Hotspot، 1 Settings Node، 45 Images.
  - `ZIP`: 34.8 MB، يحتوي `model_lite.glb` + `scene-settings.json`.
- فحص GLB:
  - `magic: 46546c67` (glTF)
  - 63 Nodes
  - 60 Materials (60 Unlit)
  - 44 WebP Images
  - 1 Hotspot marker باسم `hotspot_Hotspot_1`
  - `settingsNode: 1`
  - `extensionsUsed`: `KHR_mesh_quantization`, `EXT_texture_webp`, `KHR_texture_transform`, `KHR_materials_unlit`.

### تشغيل التطبيق
```bat
cd C:\Users\NEJMA\Downloads\cdn.soft8soft.com\model-studio
npm run dev
```
ثم افتح: `http://127.0.0.1:5173/`

---

## 8. الملفات المعدّلة

| الملف | التعديل |
|---|---|
| `src/viewer.js` | `pickModelObject()`، `flashObject()`، دعم Fog، `setPixelRatioCap` |
| `src/model.js` | `getMaterialEntriesForObject()`، تعيين `mimeType = image/webp` للخامات |
| `src/hotspots.js` | صورة الماركر، `hoverAnim`، `setIcon()`، Tooltip animation، حفظ/تحميل |
| `src/bake.js` | **جديد** — خدمة البيك (Vertex Colors + Unlit + Restore) |
| `src/zip.js` | **جديد** — إنشاء ZIP بدون مكتبات خارجية (Store + CRC32) |
| `src/main.js` | القطارة، البيك، إكسبورد المشروع، حفظ حالة البطاقات، ربط الواجهة |
| `index.html` | تبويبات Export (Lighting bake + Project export)، زر القطارة، صورة الهوت سبوت |
| `src/style.css` | أنيميشن Tooltip، Ondrag، تنسيق البطاقات المختارة |

---

## 9. ملاحظات وخطوات تالية

1. **حجم الإكسبورد**:
   - الإكسبورد يكتب الهندسة خامًا (بدون Meshopt)، لذلك قد يكون GLB الناتج أكبر من ملف الدخل المضغوط.
   - قلل الحجم عبر `Texture max size` (1024 أو 512).
   - للنشر النهائي: شغّل `gltfpack` أو قدّم الملفات بضغط gzip.
2. **البيك**:
   - هو لقطة إضاءة، وليس Lightmap/AO حقيقي.
   - إذا أردت Lightmap حقيقي، يلزم Unwrap UV + Bake خارجي (Blender/Substance).
3. **الشفافية**:
   - الخامات الشفافة بعد البيك تفقد الانعكاسات.
   - يمكن استثناء خامات معينة من البيك مستقبلًا.
4. **اختفاء الأزرار**:
   - تم إصلاح إعادة بناء البطاقات.
   - إذا حدث في تبويب آخر، أرسل صورة.
5. **تحسينات مقترحة لاحقًا**:
   - ضغط Meshopt/Draco بعد التصدير.
   - تصدير README/HTML مع المشروع.
   - حفظ آخر جلسة تلقائيًا في `localStorage`.
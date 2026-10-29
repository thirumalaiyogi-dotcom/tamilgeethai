# தமிழ் கீதை + பாரதிய பண்பாட்டு வகுப்பு — இணையதளங்கள்

| Folder | Cloudflare Worker | Domain |
|---|---|---|
| `tamilgeethai-site/` | `tamilgeethai` | tamilgeethai.com |
| `bharathiya-site/` | `bharathiyaculturalclass` | bharathiyaculturalclass-tamilgeethai.com |

ஒவ்வொரு folder-இலும் `public/` = இணையதளக் கோப்புகள், `wrangler.jsonc` = Cloudflare அமைப்பு.

Cloudflare Worker → Settings → Build → Connect to Git → இந்த repo → **Root directory** = மேலே உள்ள folder.
பிறகு `main` branch-க்கு push செய்யும் ஒவ்வொரு மாற்றமும் தானாக live ஆகும்.

`supabase/admin-setup.sql` — Admin panel தரவுத்தள அமைப்பு (Supabase SQL Editor-இல் ஒருமுறை ஓட்டவும்).

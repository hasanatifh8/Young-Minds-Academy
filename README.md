# Young Minds Academy – Coaching Institute Website

Static website for Young Minds Academy, a coaching institute for Classes 5–12, board exams, JEE, NEET, CUET, CLAT, IPMAT and CAT.

## Pages

| Page | File |
| --- | --- |
| Home | `index.html` |
| Pre-Nurture (Class 5–8) | `pre-nurture.html` |
| Pre-Foundation (Class 9–10) | `pre-foundation.html` |
| Foundation 11–12 (PCB) | `foundation-pcb.html` |
| Foundation 11–12 (PCMB) | `foundation-pcmb.html` |
| Foundation 11–12 (Commerce) | `foundation-commerce.html` |
| CUET Batches | `cuet.html` |
| Target & Foundation (CLAT / IPMAT / CAT) | `target-foundation.html` |
| Admissions & Scholarships | `admissions.html` |
| Blog / Article | `blog.html`, `blog-detail.html` |
| Exam Vault (papers, guess papers, solutions) | `exam-vault.html` |
| Exam Vault admin | `admin/papers/` |
| FAQ | `faq.html` |
| Privacy Policy / Terms | `privacy.html`, `terms.html` |

Open `index.html` in a browser to preview — no build step is needed to view the site.

## Before going live

- Contact details live in the shared header and footer of every page: +91 91296 04415, academyyoungminds@gmail.com, 10A/8 Tashkand Marg, Prayagraj.
- Replace the sample statistics, testimonials and batch timings with your real ones.
- Forms currently show a confirmation message only. Connect them to your backend, Google Forms or a service like Formspree to receive enquiries (see `assets/script.js`).
- Photos are loaded from Unsplash; swap them for photos of your own centre when available.

## Exam Vault setup (Supabase)

The Exam Vault shows sample listings from `data/sample-papers.json` until Supabase is connected.

1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/schema.sql`. It creates the `question_papers` and `paper_leads` tables,
   the `papers` storage bucket (PDFs only, 25 MB max) and Row Level Security rules so that only admins can
   upload, edit or delete, while everyone can read published papers.
3. In **Authentication → Users**, add a user for each admin, then promote them:
   ```sql
   update public.profiles set role = 'SUPER_ADMIN'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
4. Copy the **Project URL** and **anon public key** (Project Settings → API) into `assets/vault-config.js`.
5. Sign in at `/admin/papers/` and upload papers. Download counts and WhatsApp leads appear in the dashboard.

Notes:
- The WhatsApp gate is a lead-capture step, not access control: PDFs are in a public bucket, so anyone with a
  file's direct link can open it. Use it for marketing, not for paid content.
- Entering a number unlocks gated papers on that browser; numbers are saved to `paper_leads` for your team to follow up.
- Remove `data/sample-papers*` once real papers are live.

## Styling

Utility classes come from Tailwind CSS v4, compiled into `assets/output.css` from `assets/input.css`. If you add Tailwind classes that aren't already used, recompile:

```
npm install tailwindcss@4 @tailwindcss/cli@4
npx @tailwindcss/cli -i assets/input.css -o assets/output.css --minify
```

Custom component styles (buttons, cards, preloader, FAQ accordion) live in `assets/style.css`.

## Credits

Based on the CardioCare template — design and code by [K29Solutions](https://www.templatemonster.com/authors/k29solutions/), distributed by [ThemeWagon](https://themewagon.com).

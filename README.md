# Young Minds Academy – Coaching Institute Website

Static website for Young Minds Academy, a coaching institute for Classes 6–12, board exams, JEE, NEET and Olympiads.

## Pages

| Page | File |
| --- | --- |
| Home | `index.html` |
| Foundation (Class 6–8) | `foundation.html` |
| Class 9–10 Boards | `board-prep.html` |
| Class 11–12 Science | `senior-secondary.html` |
| JEE Main & Advanced | `jee.html` |
| NEET Preparation | `neet.html` |
| Olympiads & Competitive Exams | `olympiad.html` |
| Admissions & Scholarships | `admissions.html` |
| Blog / Article | `blog.html`, `blog-detail.html` |
| FAQ | `faq.html` |
| Privacy Policy / Terms | `privacy.html`, `terms.html` |

Open `index.html` in a browser to preview — no build step is needed to view the site.

## Before going live

- Replace the placeholder phone number, WhatsApp link, email and address (search for `98765 43210`, `youngmindsacademy.in` and `Example Plaza`).
- Replace the sample statistics, testimonials and batch timings with your real ones.
- Forms currently show a confirmation message only. Connect them to your backend, Google Forms or a service like Formspree to receive enquiries (see `assets/script.js`).
- Photos are loaded from Unsplash; swap them for photos of your own centre when available.

## Styling

Utility classes come from Tailwind CSS v4, compiled into `assets/output.css` from `assets/input.css`. If you add Tailwind classes that aren't already used, recompile:

```
npm install tailwindcss@4 @tailwindcss/cli@4
npx @tailwindcss/cli -i assets/input.css -o assets/output.css --minify
```

Custom component styles (buttons, cards, preloader, FAQ accordion) live in `assets/style.css`.

## Credits

Based on the CardioCare template — design and code by [K29Solutions](https://www.templatemonster.com/authors/k29solutions/), distributed by [ThemeWagon](https://themewagon.com).

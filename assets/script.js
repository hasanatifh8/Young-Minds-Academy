// Init AOS
AOS.init({ duration: 900, once: true, easing: 'ease-in-out', offset: 60 });

// Init Lucide Icons
lucide.createIcons();

// ---- PRELOADER ----
window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('preloader').classList.add('hidden');
  }, 600);
});

// ---- NAVBAR SCROLL ----
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
  if (window.scrollY > 60) {
    navbar.classList.add('scrolled');
    navbar.querySelectorAll('.nav-link').forEach(l => {
      l.style.color = document.documentElement.classList.contains('dark') ? '#CBD5E1' : '#0F172A';
    });
  } else {
    navbar.classList.remove('scrolled');
    navbar.querySelectorAll('.nav-link').forEach(l => { l.style.color = ''; });
  }
});

// ---- MOBILE MENU ----
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');
const menuOpen = document.getElementById('menu-open');
const menuClose = document.getElementById('menu-close');

mobileMenuBtn.addEventListener('click', () => {
  const isOpen = !mobileMenu.classList.contains('hidden');
  mobileMenu.classList.toggle('hidden');
  menuOpen.classList.toggle('hidden', !isOpen);
  menuClose.classList.toggle('hidden', isOpen);
});

mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.add('hidden');
    menuOpen.classList.remove('hidden');
    menuClose.classList.add('hidden');
  });
});


// ---- SCROLL TOP ----
const scrollBtn = document.getElementById('scroll-top');
window.addEventListener('scroll', () => {
  scrollBtn.classList.toggle('visible', window.scrollY > 400);
});
scrollBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ---- FAQ ACCORDION ----
function toggleFAQ(el) {
  const answer = el.nextElementSibling;
  const isOpen = answer.classList.contains('open');

  document.querySelectorAll('.faq-answer.open').forEach(a => { a.classList.remove('open'); a.style.maxHeight = ''; });
  document.querySelectorAll('.faq-question.active').forEach(q => q.classList.remove('active'));

  if (!isOpen) {
    answer.classList.add('open');
    answer.style.maxHeight = answer.scrollHeight + 40 + 'px';
    el.classList.add('active');
  }
}

// ---- FAQ PAGE: SEARCH & CATEGORY TABS ----
function filterFAQs() {
  const term = document.getElementById('faq-search').value.trim().toLowerCase();
  let anyVisible = false;
  document.querySelectorAll('.faq-group').forEach(group => {
    let groupVisible = false;
    group.querySelectorAll('.faq-item').forEach(item => {
      const match = !term || item.textContent.toLowerCase().includes(term);
      item.style.display = match ? '' : 'none';
      if (match) groupVisible = true;
    });
    group.style.display = groupVisible ? '' : 'none';
    if (groupVisible) anyVisible = true;
  });
  document.getElementById('no-faq').classList.toggle('hidden', anyVisible);
}

function scrollToCategory(id) {
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
}

// ---- BLOG PAGE: SEARCH ----
function filterPosts() {
  const term = document.getElementById('blog-search').value.trim().toLowerCase();
  let anyVisible = false;
  document.querySelectorAll('#post-list .blog-card').forEach(card => {
    const match = !term || card.textContent.toLowerCase().includes(term);
    card.style.display = match ? '' : 'none';
    if (match) anyVisible = true;
  });
  document.getElementById('no-posts').classList.toggle('hidden', anyVisible);
}

// ---- ANIMATED COUNTERS ----
function animateCounter(el, target, duration = 2000) {
  let start = 0;
  const step = (timestamp) => {
    if (!start) start = timestamp;
    const progress = Math.min((timestamp - start) / duration, 1);
    const current = Math.floor(progress * target);
    el.textContent = target > 999 ? current.toLocaleString() + '+' : current + (el.dataset.suffix || '');
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = target > 999 ? target.toLocaleString() + '+' : target + (el.dataset.suffix || '');
  };
  requestAnimationFrame(step);
}

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const target = parseInt(el.dataset.count);
      animateCounter(el, target);
      counterObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('[data-count]').forEach(el => counterObserver.observe(el));

// ---- TESTIMONIAL SLIDER ----
const track = document.getElementById('testimonial-track');
if (track) {

  const slides = track.querySelectorAll('.slide');
  const dotsContainer = document.getElementById('slider-dots');
  let currentSlide = 0;
  const getPerView = () => window.innerWidth >= 1024 ? 3 : window.innerWidth >= 768 ? 2 : 1;
  const maxSlide = () => Math.max(0, slides.length - getPerView());

  function updateSlider() {
    currentSlide = Math.min(currentSlide, maxSlide());
    const offset = currentSlide * (100 / getPerView());
    track.style.transform = `translateX(-${offset}%)`;
    dotsContainer.querySelectorAll('button').forEach((d, i) => {
      d.style.display = i > maxSlide() ? 'none' : '';
      d.classList.toggle('bg-indigo-600', i === currentSlide);
      d.classList.toggle('bg-gray-300', i !== currentSlide);
      d.classList.toggle('w-6', i === currentSlide);
      d.classList.toggle('w-2.5', i !== currentSlide);
    });
  }

  for (let i = 0; i < slides.length; i++) {
    const dot = document.createElement('button');
    dot.setAttribute('aria-label', `Go to testimonial ${i + 1}`);
    dot.className = `h-2.5 rounded-full transition-all ${i === 0 ? 'bg-indigo-600 w-6' : 'bg-gray-300 w-2.5'}`;
    dot.addEventListener('click', () => { currentSlide = i; updateSlider(); });
    dotsContainer.appendChild(dot);
  }

  document.getElementById('slide-prev').addEventListener('click', () => {
    currentSlide = Math.max(0, currentSlide - 1);
    updateSlider();
  });
  document.getElementById('slide-next').addEventListener('click', () => {
    currentSlide = Math.min(maxSlide(), currentSlide + 1);
    updateSlider();
  });

  window.addEventListener('resize', updateSlider);
  updateSlider();

  // Auto-play slider
  setInterval(() => {
    currentSlide = currentSlide >= maxSlide() ? 0 : currentSlide + 1;
    updateSlider();
  }, 5000);
}


// ---- FORM SUBMISSION ----
// Any form with a data-toast attribute shows that message on submit.
// Connect these forms to your backend, Google Forms or a service like Formspree to receive enquiries.
document.querySelectorAll('form[data-toast]').forEach(form => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showToast(form.dataset.toast);
    form.reset();
  });
});

function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.remove('translate-x-full', 'opacity-0');
  toast.classList.add('translate-x-0', 'opacity-100');
  setTimeout(() => {
    toast.classList.add('translate-x-full', 'opacity-0');
    toast.classList.remove('translate-x-0', 'opacity-100');
  }, 3500);
}

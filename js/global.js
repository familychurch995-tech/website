// ── Language System ──
let currentLang = localStorage.getItem('fc-lang') || 'pt';

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('fc-lang', lang);
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';

  const btnEn = document.getElementById('btnEn');
  const btnPt = document.getElementById('btnPt');
  if (btnEn) btnEn.classList.toggle('active', lang === 'en');
  if (btnPt) btnPt.classList.toggle('active', lang === 'pt');

  document.querySelectorAll('[data-en]').forEach(el => {
    const text = el.getAttribute('data-' + lang);
    if (text) el.innerHTML = text;
  });
}

// ── Component Loader ──
async function loadComponent(id, path) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    const basePath = document.querySelector('meta[name="base-path"]');
    const base = basePath ? basePath.content : '';
    const res = await fetch(base + path);
    if (res.ok) {
      el.innerHTML = await res.text();
      // Re-apply language after loading component
      setLang(currentLang);
      // Re-bind hamburger if header was loaded
      if (id === 'header-placeholder') {
        initMobileMenu();
      }
    }
  } catch (e) {
    console.error('Failed to load component:', path, e);
  }
}

// ── Mobile Menu ──
function initMobileMenu() {
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  if (!hamburger || !navLinks) return;

  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    navLinks.classList.toggle('open');
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      navLinks.classList.remove('open');
    });
  });
}

// ── Navbar Scroll Effect ──
function initNavScroll() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  });
}

// ── Scroll Animations ──
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
}

// ── Initialize ──
document.addEventListener('DOMContentLoaded', async () => {
  // Load shared components
  await Promise.all([
    loadComponent('header-placeholder', 'components/header.html'),
    loadComponent('footer-placeholder', 'components/footer.html')
  ]);

  // Init features
  initNavScroll();
  initScrollAnimations();

  // Apply saved language (PT is default)
  setLang(currentLang);
});

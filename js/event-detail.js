// ── Event Detail Page Logic ──

let galleryPhotos = [];
let currentPhotoIndex = 0;

function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (lb && img) {
    img.src = src;
    currentPhotoIndex = galleryPhotos.indexOf(src);
    lb.classList.add('active');
    updateLightboxNav();
  }
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.classList.remove('active');
}

function lightboxPrev() {
  if (galleryPhotos.length <= 1) return;
  currentPhotoIndex = (currentPhotoIndex - 1 + galleryPhotos.length) % galleryPhotos.length;
  document.getElementById('lightbox-img').src = galleryPhotos[currentPhotoIndex];
  updateLightboxNav();
}

function lightboxNext() {
  if (galleryPhotos.length <= 1) return;
  currentPhotoIndex = (currentPhotoIndex + 1) % galleryPhotos.length;
  document.getElementById('lightbox-img').src = galleryPhotos[currentPhotoIndex];
  updateLightboxNav();
}

function updateLightboxNav() {
  const counter = document.getElementById('lightbox-counter');
  if (counter && galleryPhotos.length > 1) {
    counter.textContent = `${currentPhotoIndex + 1} / ${galleryPhotos.length}`;
    counter.style.display = 'block';
  }
  const prevBtn = document.getElementById('lightbox-prev');
  const nextBtn = document.getElementById('lightbox-next');
  if (prevBtn) prevBtn.style.display = galleryPhotos.length > 1 ? 'block' : 'none';
  if (nextBtn) nextBtn.style.display = galleryPhotos.length > 1 ? 'block' : 'none';
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  const lb = document.getElementById('lightbox');
  if (!lb || !lb.classList.contains('active')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightboxPrev();
  if (e.key === 'ArrowRight') lightboxNext();
});

// Schedule icon SVGs
const scheduleIcons = {
  coffee: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>',
  music: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  lecture: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  code: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  gift: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>'
};

async function loadEventDetail() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('id');
  if (!eventId) {
    window.location.href = 'events/index.html';
    return;
  }

  try {
    const res = await fetch('data/events.json');
    if (!res.ok) return;
    const events = await res.json();
    const event = events.find(e => e.id === eventId);

    if (!event) {
      window.location.href = 'events/index.html';
      return;
    }

    const lang = currentLang || 'pt';
    const title = lang === 'en' ? event.title_en : event.title_pt;
    const desc = lang === 'en' ? event.description_en : event.description_pt;
    const location = lang === 'en' ? event.location_en : event.location_pt;

    // Update page title
    document.title = `${title} | Family Church`;

    // Format date
    let dateStr = 'TBD';
    if (event.date && event.date !== 'TBD') {
      const d = new Date(event.date + 'T00:00:00');
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      dateStr = d.toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US', options);
    }

    const timeStr = event.time || 'TBD';

    // Build presenters
    let presentersHtml = '';
    const presenters = lang === 'en' ? event.presenters_en : event.presenters_pt;
    if (presenters && presenters.length > 0) {
      presentersHtml = `
        <div class="event-presenters fade-in">
          <h3 data-en="Presented by" data-pt="Apresentado por">${lang === 'en' ? 'Presented by' : 'Apresentado por'}</h3>
          <div class="presenters-list">
            ${presenters.map(p => `<span class="presenter-chip">${p}</span>`).join('')}
          </div>
        </div>
      `;
    }

    // Build highlights
    let highlightsHtml = '';
    if (event.highlights_en && event.highlights_en.length > 0) {
      highlightsHtml = `
        <div class="event-highlights fade-in">
          ${event.highlights_en.map((hEn, i) => {
            const hPt = event.highlights_pt[i] || hEn;
            return `<span class="event-highlight-chip ${i % 2 === 0 ? 'accent' : ''}" data-en="${hEn}" data-pt="${hPt}">${lang === 'en' ? hEn : hPt}</span>`;
          }).join('')}
        </div>
      `;
    }

    // Build schedule
    let scheduleHtml = '';
    if (event.schedule && event.schedule.length > 0) {
      const scheduleItems = event.schedule.map((s, i) => {
        const sTitle = lang === 'en' ? s.title_en : s.title_pt;
        const sDesc = lang === 'en' ? s.desc_en : s.desc_pt;
        const icon = scheduleIcons[s.icon] || scheduleIcons.coffee;
        return `
          <div class="schedule-item fade-in" style="animation-delay: ${i * 0.1}s">
            <div class="schedule-time">${s.time}</div>
            <div class="schedule-line">
              <div class="schedule-dot">${icon}</div>
              ${i < event.schedule.length - 1 ? '<div class="schedule-connector"></div>' : ''}
            </div>
            <div class="schedule-content">
              <h4 data-en="${s.title_en}" data-pt="${s.title_pt}">${sTitle}</h4>
              <p data-en="${s.desc_en}" data-pt="${s.desc_pt}">${sDesc}</p>
            </div>
          </div>
        `;
      }).join('');

      scheduleHtml = `
        <div class="event-schedule-section fade-in">
          <h3 data-en="Schedule" data-pt="Programação">${lang === 'en' ? 'Schedule' : 'Programação'}</h3>
          <div class="schedule-timeline">
            ${scheduleItems}
          </div>
        </div>
      `;
    }

    // Build topics list
    let topicsHtml = '';
    if (event.topics_en && event.topics_en.length > 0) {
      topicsHtml = `
        <div class="event-topics-section fade-in">
          <h3 data-en="What You'll Learn" data-pt="O Que Você Vai Aprender">${lang === 'en' ? "What You'll Learn" : 'O Que Você Vai Aprender'}</h3>
          <ul class="topics-list">
            ${event.topics_en.map((tEn, i) => {
              const tPt = event.topics_pt[i] || tEn;
              return `<li data-en="<span class='topic-icon'>&#9654;</span> ${tEn}" data-pt="<span class='topic-icon'>&#9654;</span> ${tPt}"><span class="topic-icon">&#9654;</span> ${lang === 'en' ? tEn : tPt}</li>`;
            }).join('')}
          </ul>
        </div>
      `;
    }

    // Build photos gallery
    let photosHtml = '';
    galleryPhotos = event.photos && event.photos.length > 0 ? [...event.photos] : [];
    if (galleryPhotos.length > 0) {
      photosHtml = `
        <div class="event-photos-section fade-in">
          <h3 data-en="Photos" data-pt="Fotos">${lang === 'en' ? 'Photos' : 'Fotos'}</h3>
          <div class="photo-gallery">
            ${galleryPhotos.map(p => `<img src="${p}" alt="${title}" onclick="openLightbox('${p}')" loading="lazy" />`).join('')}
          </div>
        </div>
      `;
    }

    // Build verse
    let verseHtml = '';
    if (event.verse) {
      const verseText = lang === 'en' ? event.verse_text_en : event.verse_text_pt;
      verseHtml = `
        <div class="event-verse fade-in">
          ${verseText ? `<p class="verse-text">"${verseText}"</p>` : ''}
          <p class="verse-ref">${event.verse}</p>
        </div>
      `;
    }

    // Build flyers
    let flyersHtml = '';
    if (event.flyer_pt || event.flyer_en) {
      flyersHtml = `
        <div class="event-flyers-section fade-in">
          <h3 data-en="Event Flyer" data-pt="Cartaz do Evento">${lang === 'en' ? 'Event Flyer' : 'Cartaz do Evento'}</h3>
          <div class="flyers-row">
            ${event.flyer_pt ? `<div class="flyer-preview" onclick="openLightbox('${event.flyer_pt}')"><img src="${event.flyer_pt}" alt="Cartaz Português" loading="lazy" /><span class="flyer-tag">PT</span></div>` : ''}
            ${event.flyer_en ? `<div class="flyer-preview" onclick="openLightbox('${event.flyer_en}')"><img src="${event.flyer_en}" alt="English Flyer" loading="lazy" /><span class="flyer-tag">EN</span></div>` : ''}
          </div>
        </div>
      `;
      // Add flyers to gallery for lightbox navigation
      if (event.flyer_pt) galleryPhotos.push(event.flyer_pt);
      if (event.flyer_en) galleryPhotos.push(event.flyer_en);
    }

    // Build interactive demo link (for dons-digitais)
    let interactiveDemoHtml = '';
    if (event.id === 'dons-digitais-2026') {
      interactiveDemoHtml = `
        <div class="event-cta fade-in">
          <div class="cta-card">
            <div class="cta-content">
              <h3 data-en="Try It Now — Interactive Demo!" data-pt="Experimente Agora — Demo Interativa!">${lang === 'en' ? 'Try It Now — Interactive Demo!' : 'Experimente Agora — Demo Interativa!'}</h3>
              <p data-en="Learn programming logic through fun jokes — no code needed!" data-pt="Aprenda lógica de programação com piadas divertidas — sem precisar programar!">${lang === 'en' ? 'Learn programming logic through fun jokes — no code needed!' : 'Aprenda lógica de programação com piadas divertidas — sem precisar programar!'}</p>
            </div>
            <a href="logic-jokes.html" class="btn btn-cta-register" data-en="&#9654; Open Interactive App" data-pt="&#9654; Abrir App Interativo">${lang === 'en' ? '&#9654; Open Interactive App' : '&#9654; Abrir App Interativo'}</a>
          </div>
        </div>
        <div class="event-cta fade-in">
          <div class="cta-card">
            <div class="cta-content">
              <h3 data-en="&#9889; Vibe Coding — Build Your App!" data-pt="&#9889; Vibe Coding — Crie Seu App!">${lang === 'en' ? '&#9889; Vibe Coding — Build Your App!' : '&#9889; Vibe Coding — Crie Seu App!'}</h3>
              <p data-en="Describe what you want and AI builds it for you — no coding skills needed!" data-pt="Descreva o que você quer e a IA cria pra você — sem precisar saber programar!">${lang === 'en' ? 'Describe what you want and AI builds it for you — no coding skills needed!' : 'Descreva o que você quer e a IA cria pra você — sem precisar saber programar!'}</p>
            </div>
            <a href="vibe-coding.html" class="btn btn-cta-register" data-en="&#128640; Start Vibe Coding" data-pt="&#128640; Começar Vibe Coding">${lang === 'en' ? '&#128640; Start Vibe Coding' : '&#128640; Começar Vibe Coding'}</a>
          </div>
        </div>
      `;
    }

    // Build registration CTA
    let registrationHtml = '';
    if (event.registration_url && event.status === 'upcoming') {
      registrationHtml = `
        <div class="event-cta fade-in">
          <div class="cta-card">
            <div class="cta-content">
              <h3 data-en="Ready to join?" data-pt="Pronto para participar?">${lang === 'en' ? 'Ready to join?' : 'Pronto para participar?'}</h3>
              <p data-en="Secure your spot — it takes 2 seconds!" data-pt="Garanta sua vaga — leva 2 segundos!">${lang === 'en' ? 'Secure your spot — it takes 2 seconds!' : 'Garanta sua vaga — leva 2 segundos!'}</p>
            </div>
            <a href="${event.registration_url}" class="btn btn-cta-register" data-en="Register Now" data-pt="Inscreva-se Agora">${lang === 'en' ? 'Register Now' : 'Inscreva-se Agora'}</a>
          </div>
        </div>
      `;
    }

    // Build contact
    let contactHtml = '';
    if (event.contact_phone) {
      contactHtml = `
        <div class="event-contact fade-in">
          <p data-en="Questions? Call us:" data-pt="Dúvidas? Ligue para nós:">
            ${lang === 'en' ? 'Questions? Call us:' : 'Dúvidas? Ligue para nós:'}
          </p>
          <a href="tel:${event.contact_phone.replace(/[^\d+]/g, '')}" class="contact-phone">${event.contact_phone}</a>
        </div>
      `;
    }

    const container = document.getElementById('event-detail');
    container.innerHTML = `
      <!-- Event Hero -->
      <section class="page-header" style="padding-bottom: 80px;${event.image ? ` background: linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.7)), url('${event.image}') center/cover no-repeat;` : ''}">
        <div class="container">
          <p style="color: rgba(255,255,255,0.6); margin-bottom: 12px;">
            <a href="events/index.html" style="color: rgba(255,255,255,0.8); text-decoration: underline;" data-en="&larr; Back to Events" data-pt="&larr; Voltar aos Eventos">${lang === 'en' ? '&larr; Back to Events' : '&larr; Voltar aos Eventos'}</a>
          </p>
          <h1 data-en="${event.title_en}" data-pt="${event.title_pt}">${title}</h1>
          <div style="display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; margin-top: 20px; color: rgba(255,255,255,0.8); font-size: 0.95rem;">
            <span>&#128197; ${dateStr}</span>
            <span>&#128336; ${timeStr}</span>
            <span>&#128205; ${location}</span>
          </div>
          ${event.registration_url && event.status === 'upcoming' ? `
            <div style="margin-top: 28px;">
              <a href="${event.registration_url}" class="btn btn-primary" style="font-size: 1rem; padding: 16px 40px;" data-en="Register Now — It's Free!" data-pt="Inscreva-se — É Gratuito!">${lang === 'en' ? "Register Now — It's Free!" : 'Inscreva-se — É Gratuito!'}</a>
            </div>
          ` : ''}
        </div>
      </section>

      <!-- Event Body -->
      <div class="event-detail-body">
        ${highlightsHtml}
        ${presentersHtml}

        <p class="event-description fade-in" data-en="${event.description_en}" data-pt="${event.description_pt}">${desc}</p>

        ${verseHtml}
        ${scheduleHtml}
        ${topicsHtml}
        ${registrationHtml}
        ${flyersHtml}
        ${photosHtml}
        ${contactHtml}
        ${interactiveDemoHtml}

        <div style="margin-top: 48px; text-align: center;" class="fade-in">
          <a href="events/index.html" class="btn btn-navy" data-en="&larr; All Events" data-pt="&larr; Todos os Eventos">${lang === 'en' ? '&larr; All Events' : '&larr; Todos os Eventos'}</a>
        </div>
      </div>
    `;

    // Re-apply language
    if (typeof setLang === 'function') setLang(currentLang);

    // Re-init scroll animations for new elements
    if (typeof initScrollAnimations === 'function') initScrollAnimations();

  } catch (e) {
    console.error('Failed to load event detail:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadEventDetail, 150);
});

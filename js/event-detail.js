// ── Event Detail Page Logic ──

function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (lb && img) {
    img.src = src;
    lb.classList.add('active');
  }
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.classList.remove('active');
}

// Close lightbox on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

async function loadEventDetail() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('id');
  if (!eventId) {
    window.location.href = '/events/';
    return;
  }

  try {
    const res = await fetch('data/events.json');
    if (!res.ok) return;
    const events = await res.json();
    const event = events.find(e => e.id === eventId);

    if (!event) {
      window.location.href = '/events/';
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

    // Build topics list
    let topicsHtml = '';
    const topics = lang === 'en' ? event.topics_en : event.topics_pt;
    if (topics && topics.length > 0) {
      topicsHtml = `
        <div style="margin-top: 32px;">
          <h3 style="font-family: 'Inter', sans-serif; font-weight: 600; color: var(--navy); margin-bottom: 16px;" data-en="What You'll Learn" data-pt="O Que Você Vai Aprender">${lang === 'en' ? "What You'll Learn" : 'O Que Você Vai Aprender'}</h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 10px;">
            ${topics.map(t => `<li style="display: flex; align-items: center; gap: 10px; color: var(--text-light);"><span style="color: var(--accent); font-weight: 700;">▶</span> ${t}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    // Build photos gallery
    let photosHtml = '';
    if (event.photos && event.photos.length > 0) {
      photosHtml = `
        <div style="margin-top: 48px;">
          <h3 style="font-family: 'Inter', sans-serif; font-weight: 600; color: var(--navy); margin-bottom: 20px;" data-en="Photos" data-pt="Fotos">${lang === 'en' ? 'Photos' : 'Fotos'}</h3>
          <div class="photo-gallery">
            ${event.photos.map(p => `<img src="${p}" alt="${title}" onclick="openLightbox('${p}')" loading="lazy" />`).join('')}
          </div>
        </div>
      `;
    }

    // Build verse
    let verseHtml = '';
    if (event.verse) {
      verseHtml = `
        <div style="margin-top: 24px; padding: 16px 20px; border-left: 3px solid var(--accent); background: var(--off-white); border-radius: 0 var(--radius) var(--radius) 0;">
          <p style="color: var(--text-light); font-style: italic; font-size: 0.9rem;">📖 ${event.verse}</p>
        </div>
      `;
    }

    const container = document.getElementById('event-detail');
    container.innerHTML = `
      <!-- Event Hero -->
      <section class="page-header" style="padding-bottom: 80px;${event.image ? ` background: linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.7)), url('${event.image}') center/cover no-repeat;` : ''}">
        <div class="container">
          <p style="color: rgba(255,255,255,0.6); margin-bottom: 12px;">
            <a href="/events/" style="color: rgba(255,255,255,0.8); text-decoration: underline;" data-en="← Back to Events" data-pt="← Voltar aos Eventos">${lang === 'en' ? '← Back to Events' : '← Voltar aos Eventos'}</a>
          </p>
          <h1 data-en="${event.title_en}" data-pt="${event.title_pt}">${title}</h1>
          <div style="display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; margin-top: 20px; color: rgba(255,255,255,0.8); font-size: 0.95rem;">
            <span>📅 ${dateStr}</span>
            <span>🕐 ${timeStr}</span>
            <span>📍 ${location}</span>
          </div>
        </div>
      </section>

      <!-- Event Body -->
      <div class="event-detail-body">
        <p style="font-size: 1.1rem; color: var(--text); line-height: 1.8;" data-en="${event.description_en}" data-pt="${event.description_pt}">${desc}</p>

        ${verseHtml}
        ${topicsHtml}
        ${photosHtml}

        <div style="margin-top: 48px; text-align: center;">
          <a href="/events/" class="btn btn-navy" data-en="← All Events" data-pt="← Todos os Eventos">${lang === 'en' ? '← All Events' : '← Todos os Eventos'}</a>
        </div>
      </div>
    `;

    // Re-apply language
    if (typeof setLang === 'function') setLang(currentLang);

  } catch (e) {
    console.error('Failed to load event detail:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadEventDetail, 150);
});

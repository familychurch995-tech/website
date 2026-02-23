// ── Events Listing Page Logic ──

const months_en = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const months_pt = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

function renderEventCard(event, lang) {
  let monthEn = 'TBD', monthPt = 'TBD', day = '--';
  if (event.date && event.date !== 'TBD') {
    const d = new Date(event.date + 'T00:00:00');
    monthEn = months_en[d.getMonth()];
    monthPt = months_pt[d.getMonth()];
    day = String(d.getDate()).padStart(2, '0');
  }

  const title = lang === 'en' ? event.title_en : event.title_pt;
  const desc = lang === 'en' ? event.description_en : event.description_pt;
  const month = lang === 'en' ? monthEn : monthPt;
  const hasPhotos = event.photos && event.photos.length > 0;

  return `
    <a href="/event.html?id=${event.id}" class="event-card fade-in" style="text-decoration:none;">
      <div class="event-date">
        <span class="month" data-en="${monthEn}" data-pt="${monthPt}">${month}</span>
        <span class="day">${day}</span>
      </div>
      <div class="event-divider"></div>
      <div class="event-info">
        <h3 data-en="${event.title_en}" data-pt="${event.title_pt}">${title}</h3>
        <p data-en="${event.description_en.substring(0, 150)}..." data-pt="${event.description_pt.substring(0, 150)}...">${desc.substring(0, 150)}...</p>
        ${hasPhotos ? `<span style="font-size:0.8rem; color:var(--accent); margin-top:8px; display:inline-block;" data-en="📸 View Photos" data-pt="📸 Ver Fotos">${lang === 'en' ? '📸 View Photos' : '📸 Ver Fotos'}</span>` : ''}
      </div>
    </a>
  `;
}

async function loadEvents() {
  try {
    const res = await fetch('../data/events.json');
    if (!res.ok) return;
    const events = await res.json();
    const lang = currentLang || 'pt';

    const upcoming = events.filter(e => e.status === 'upcoming');
    const past = events.filter(e => e.status === 'past');

    const upcomingContainer = document.getElementById('upcoming-events');
    const pastContainer = document.getElementById('past-events');
    const noPastMsg = document.getElementById('no-past-events');

    if (upcomingContainer) {
      if (upcoming.length > 0) {
        upcomingContainer.innerHTML = upcoming.map(e => renderEventCard(e, lang)).join('');
      } else {
        upcomingContainer.innerHTML = `<p class="fade-in" style="text-align:center; color:var(--text-light);" data-en="No upcoming events at the moment." data-pt="Nenhum evento próximo no momento.">${lang === 'en' ? 'No upcoming events at the moment.' : 'Nenhum evento próximo no momento.'}</p>`;
      }
    }

    if (pastContainer) {
      if (past.length > 0) {
        pastContainer.innerHTML = past.map(e => renderEventCard(e, lang)).join('');
        if (noPastMsg) noPastMsg.style.display = 'none';
      } else {
        if (noPastMsg) noPastMsg.style.display = 'block';
      }
    }

    // Re-init animations
    if (typeof initScrollAnimations === 'function') {
      initScrollAnimations();
    }
  } catch (e) {
    console.error('Failed to load events:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadEvents, 150);
});

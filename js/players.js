/* ============================================
   D.D SPORTS MANAGEMENT — PLAYERS JS
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  const grid       = document.querySelector('#players-grid');
  const filterTabs = document.querySelectorAll('.filter-tab');
  const searchInput = document.querySelector('#player-search');
  const loadMoreBtn = document.querySelector('#load-more-btn');
  const countBadge  = document.querySelector('#visible-count');

  if (!grid) return;

  const allCards  = Array.from(grid.querySelectorAll('.player-card'));
  const VISIBLE   = 12;
  let currentFilter = 'all';
  let currentSearch = '';
  let showAll = false;

  const getVisible = () => {
    return allCards.filter(card => {
      const pos   = card.dataset.position || '';
      const name  = (card.dataset.name || '').toLowerCase();
      const matchFilter = currentFilter === 'all' || pos === currentFilter;
      const matchSearch = !currentSearch || name.includes(currentSearch);
      return matchFilter && matchSearch;
    });
  };

  const render = () => {
    const visible = getVisible();

    allCards.forEach(card => {
      card.classList.add('hidden');
    });

    const toShow = showAll ? visible : visible.slice(0, VISIBLE);
    toShow.forEach((card, i) => {
      card.classList.remove('hidden');
      // Re-trigger AOS
      card.removeAttribute('data-aos-delay');
      card.setAttribute('data-aos-delay', String((i % 4) * 80));
    });

    // Update count
    if (countBadge) {
      countBadge.textContent = visible.length;
    }

    // Load more button visibility
    if (loadMoreBtn) {
      if (visible.length > VISIBLE && !showAll) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.textContent = `Load More Players (${visible.length - VISIBLE} remaining)`;
      } else {
        loadMoreBtn.classList.add('hidden');
      }
    }
  };

  /* ── FILTER TABS ── */
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter || 'all';
      showAll = false;
      render();
    });
  });

  /* ── SEARCH ── */
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentSearch = searchInput.value.trim().toLowerCase();
      showAll = false;
      render();
    });
  }

  /* ── LOAD MORE ── */
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      showAll = true;
      render();
    });
  }

  /* ── INITIAL RENDER ── */
  render();

});

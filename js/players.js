/* ============================================
   D.D SPORTS MANAGEMENT — PLAYERS JS
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  const grid       = document.querySelector('#players-grid');
  const filterTabs = document.querySelectorAll('.filter-tab');
  const searchInput = document.querySelector('#player-search');
  const loadMoreBtn = document.querySelector('#load-more-btn');
  const countBadge  = document.querySelector('#visible-count');
  const categoryTabs = document.querySelectorAll('.category-tab');
  const emptyState  = document.querySelector('#players-empty');

  if (!grid) return;

  const allCards  = Array.from(grid.querySelectorAll('.player-card'));
  const VISIBLE   = 12;
  let currentCategory = location.hash === '#development' ? 'development' : 'professional';
  let currentFilter = 'all';
  let currentSearch = '';
  let showAll = false;

  const getVisible = () => {
    return allCards.filter(card => {
      const pos   = card.dataset.position || '';
      const name  = (card.dataset.name || '').toLowerCase();
      const matchCategory = (card.dataset.category || 'professional') === currentCategory;
      const matchFilter = currentFilter === 'all' || pos === currentFilter;
      const matchSearch = !currentSearch || name.includes(currentSearch);
      return matchCategory && matchFilter && matchSearch;
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

    // Empty state (e.g. no development players yet)
    if (emptyState) {
      const inCategory = allCards.some(card => (card.dataset.category || 'professional') === currentCategory);
      emptyState.classList.toggle('hidden', inCategory);
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

    // AOS measured card offsets before filtering; re-measure so cards that
    // moved up the grid animate in instead of waiting for a scroll.
    if (window.AOS) AOS.refresh();
  };

  /* ── CATEGORY TABS ── */
  const setCategory = (category) => {
    currentCategory = category;
    categoryTabs.forEach(t => {
      const isActive = t.dataset.category === category;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', String(isActive));
    });
  };

  categoryTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      setCategory(tab.dataset.category);
      history.replaceState(null, '', currentCategory === 'development' ? '#development' : location.pathname);
      showAll = false;
      render();
    });
  });

  setCategory(currentCategory);

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

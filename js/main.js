/* ============================================
   D.D SPORTS MANAGEMENT — MAIN JS
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── NAVBAR SCROLL BEHAVIOR ── */
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    const onScroll = () => {
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // run once on load
  }


  /* ── ACTIVE NAV LINK ── */
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.navbar-links a, .mobile-nav-links a');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage ||
        (currentPage === '' && href === 'index.html') ||
        (currentPage === 'index.html' && href === 'index.html')) {
      link.classList.add('active');
    }
  });


  /* ── MOBILE MENU ── */
  const hamburger  = document.querySelector('.hamburger');
  const mobileNav  = document.querySelector('.mobile-nav');
  const body       = document.body;

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileNav.classList.contains('open');
      mobileNav.classList.toggle('open');
      hamburger.classList.toggle('active');
      body.style.overflow = isOpen ? '' : 'hidden';
    });

    // Close on overlay click
    mobileNav.addEventListener('click', (e) => {
      if (e.target === mobileNav) {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('active');
        body.style.overflow = '';
      }
    });

    // Close on nav link click
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('active');
        body.style.overflow = '';
      });
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('active');
        body.style.overflow = '';
      }
    });
  }


  /* ── AOS INIT ── */
  if (typeof AOS !== 'undefined') {
    AOS.init({
      offset:   80,
      duration: 700,
      easing:   'ease-out-cubic',
      once:     true,
    });
  }


  /* ── COUNTER ANIMATION ── */
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length > 0) {
    const animateCounter = (el) => {
      const target   = parseFloat(el.dataset.count);
      const suffix   = el.dataset.suffix || '';
      const prefix   = el.dataset.prefix || '';
      const duration = 2000;
      const steps    = 60;
      const stepTime = duration / steps;
      let current    = 0;
      const increment = target / steps;

      const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
          current = target;
          clearInterval(timer);
        }
        const display = Number.isInteger(target)
          ? Math.round(current)
          : current.toFixed(1);
        el.textContent = prefix + display + suffix;
      }, stepTime);
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.dataset.animated) {
          entry.target.dataset.animated = 'true';
          animateCounter(entry.target);
        }
      });
    }, { threshold: 0.5 });

    counters.forEach(counter => observer.observe(counter));
  }


  /* ── IMAGE REVEAL ── */
  const imgRevealEls = document.querySelectorAll('.img-reveal');
  if (imgRevealEls.length > 0) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });
    imgRevealEls.forEach(el => revealObserver.observe(el));
  }


  /* ── SMOOTH ANCHOR SCROLLING ── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = parseInt(getComputedStyle(document.documentElement)
          .getPropertyValue('--nav-height')) || 72;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });


  /* ── NEWSLETTER FORM ── */
  const newsletterForms = document.querySelectorAll('.newsletter-form');
  newsletterForms.forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      if (input && input.value) {
        input.value = '';
        const btn = form.querySelector('button');
        if (btn) {
          const original = btn.textContent;
          btn.textContent = 'Subscribed!';
          btn.style.background = '#22c55e';
          setTimeout(() => {
            btn.textContent = original;
            btn.style.background = '';
          }, 3000);
        }
      }
    });
  });


  /* ── CONTACT FORM ── */
  const contactForm = document.querySelector('#contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = contactForm.querySelector('button[type="submit"]');
      const original = btn ? btn.innerHTML : '';
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
        btn.disabled = true;
      }
      const data = new FormData(contactForm);
      try {
        const res = await fetch(contactForm.action, {
          method: 'POST',
          body: data,
          headers: { Accept: 'application/json' }
        });
        if (res.ok) {
          if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Message Sent!';
            btn.style.background = '#22c55e';
          }
          contactForm.reset();
          setTimeout(() => {
            if (btn) {
              btn.innerHTML = original;
              btn.style.background = '';
              btn.disabled = false;
            }
          }, 5000);
        } else {
          throw new Error('Server error');
        }
      } catch {
        if (btn) {
          btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Failed — try WhatsApp';
          btn.style.background = '#ef4444';
          setTimeout(() => {
            btn.innerHTML = original;
            btn.style.background = '';
            btn.disabled = false;
          }, 4000);
        }
      }
    });
  }


  /* ── HERO PARALLAX disabled — hero uses contain to show full image ── */

});

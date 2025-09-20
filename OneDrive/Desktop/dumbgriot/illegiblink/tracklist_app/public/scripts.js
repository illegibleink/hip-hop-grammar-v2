document.addEventListener('DOMContentLoaded', () => {
  const stripe = Stripe(document.body.dataset.stripeKey || '');
  const cartModal = document.querySelector('.cart-modal');
  const cartItems = document.querySelector('.cart-items');
  const cartTotal = document.querySelector('.cart-total');
  const themeToggle = document.querySelector('.theme-toggle');
  const body = document.body;

  // Theme Toggle
  const toggleTheme = () => {
    const isDark = body.classList.contains('dark-mode');
    body.classList.toggle('dark-mode', !isDark);
    body.classList.toggle('light-mode', isDark);
    themeToggle.textContent = isDark ? '☀️' : '🌙';
    fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `mutation { setTheme(theme: "${isDark ? 'light' : 'dark'}") }`
      }),
      credentials: 'include'
    }).catch(error => console.error('Error saving theme:', error));
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
  };

  // Initialize Theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    body.classList.add('dark-mode');
    body.classList.remove('light-mode');
    themeToggle.textContent = '☀️';
  } else {
    body.classList.add('light-mode');
    body.classList.remove('dark-mode');
    themeToggle.textContent = '🌙';
  }

  themeToggle.addEventListener('click', toggleTheme);

  const updateCart = async () => {
    try {
      const response = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query { cart { name price uniqueGenres } }`
        }),
        credentials: 'include'
      });
      const { data, errors } = await response.json();
      if (errors) throw new Error(errors[0].message);
      cartItems.innerHTML = data.cart.map(tracklist => `<div class="cart-item">${tracklist.name} ($${tracklist.price.toFixed(2)}) - ${tracklist.uniqueGenres.join(', ') || 'Unknown'}</div>`).join('');
      const total = data.cart.reduce((sum, tracklist) => sum + tracklist.price, 0);
      cartTotal.textContent = `Total: $${total.toFixed(2)}`;
    } catch (error) {
      console.error('Error updating cart:', error.message);
      cartItems.innerHTML = '<p>Error loading cart</p>';
    }
  };

  document.querySelectorAll('.track-card').forEach(card => {
    const trackInfo = card.querySelector('.track-info');
    const initialHtml = trackInfo.innerHTML;
    let isToggled = false;

    trackInfo.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      if (!card.dataset.tracklistName) return;
      isToggled = !isToggled;
      if (isToggled) {
        const yearSpan = card.dataset.yearSpan || '1989-1989 (0 years)';
        const genres = card.dataset.genres || 'Unknown';
        trackInfo.innerHTML = `
          <h3>${card.querySelector('h3').textContent}</h3>
          <p>Years: ${yearSpan}</p>
          <p>Genres: ${genres}</p>
        `;
      } else {
        trackInfo.innerHTML = initialHtml;
        if (card.querySelector('.track-name.purchased')) {
          card.querySelectorAll('.artist-release').forEach(artist => {
            artist.classList.add('visible');
          });
        }
      }
    });
  });

  document.querySelectorAll('.unlock').forEach(button => {
    button.addEventListener('click', async () => {
      const tracklistName = button.dataset.tracklistName;
      if (!tracklistName) {
        console.error('Unlock failed: Missing tracklistName');
        return alert('Error: Invalid tracklist');
      }
      const tracklistNumber = parseInt(tracklistName.replace('set', '')) || 0;
      const isFree = tracklistNumber <= 12;
      console.log(`Unlock clicked for ${tracklistName} (isFree: ${isFree})`);
      try {
        if (isFree) {
          const response = await fetch('/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracklistName }),
            credentials: 'include'
          });
          const result = await response.json();
          console.log(`Purchase response for ${tracklistName}:`, result);
          if (response.ok) {
            const card = button.closest('.track-card');
            card.querySelectorAll('.track-name').forEach(name => {
              name.classList.remove('locked');
              name.classList.add('purchased', 'animate');
            });
            card.querySelectorAll('.artist-release').forEach(artist => {
              artist.classList.add('visible', 'animate');
            });
            button.classList.remove('unlock');
            button.classList.add('unlocked');
            button.textContent = 'Unlocked';
            button.disabled = true;
            setTimeout(() => {
              window.location.reload();
            }, 500);
          } else {
            console.error('Purchase failed:', result.message);
            if (result.code === 401) {
              window.location.href = `/login?redirect=/tracks?page=${new URLSearchParams(window.location.search).get('page') || 1}`;
            } else {
              alert(result.message || 'Error unlocking tracklist');
            }
          }
        } else {
          const response = await fetch('/add-to-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracklistName }),
            credentials: 'include'
          });
          const result = await response.json();
          console.log(`Add-to-cart response for ${tracklistName}:`, result);
          if (response.ok) {
            cartModal.classList.add('open');
            await updateCart();
          } else {
            console.error('Add to cart failed:', result.message);
            if (result.code === 401) {
              window.location.href = `/login?redirect=/tracks?page=${new URLSearchParams(window.location.search).get('page') || 1}`;
            } else {
              alert(result.message || 'Error adding to cart');
            }
          }
        }
      } catch (error) {
        console.error('Network error:', error.message);
        alert('Network error: ' + error.message);
      }
    });
  });

  const checkoutCartButton = document.querySelector('.checkout-cart');
  if (checkoutCartButton) {
    checkoutCartButton.addEventListener('click', async () => {
      const page = new URLSearchParams(window.location.search).get('page') || 1;
      try {
        const response = await fetch(`/checkout?page=${page}`, {
          credentials: 'include'
        });
        const result = await response.json();
        console.log('Checkout response:', result);
        if (response.ok) {
          window.location.href = result.url;
        } else {
          console.error('Checkout failed:', result.message);
          if (result.code === 401) {
            window.location.href = `/login?redirect=/tracks?page=${page}`;
          } else {
            alert(result.message || 'Checkout error');
          }
        }
      } catch (error) {
        console.error('Checkout network error:', error.message);
        alert('Checkout error: ' + error.message);
      }
    });
  }

  const closeModalButton = document.querySelector('.close-modal');
  if (closeModalButton) {
    closeModalButton.addEventListener('click', () => {
      cartModal.classList.remove('open');
    });
  }

  const clearCartButton = document.querySelector('.clear-cart');
  if (clearCartButton) {
    clearCartButton.addEventListener('click', async () => {
      try {
        const response = await fetch('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `mutation { clearCart }`
          }),
          credentials: 'include'
        });
        const { errors } = await response.json();
        if (errors) throw new Error(errors[0].message);
        await updateCart();
      } catch (error) {
        console.error('Error clearing cart:', error.message);
        if (error.message.includes('Not authenticated')) {
          window.location.href = `/login?redirect=/tracks?page=${new URLSearchParams(window.location.search).get('page') || 1}`;
        } else {
          alert('Error clearing cart: ' + error.message);
        }
      }
    });
  }

  document.querySelector('.logout-button').addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await fetch('/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/';
    } catch (error) {
      console.error('Logout failed:', error.message);
      alert('Error logging out: ' + error.message);
    }
  });
});
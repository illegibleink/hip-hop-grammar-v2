document.addEventListener('DOMContentLoaded', () => {
  const stripe = Stripe(document.body.dataset.stripeKey || '');
  const cartModal = document.querySelector('.cart-modal');
  const cartItems = document.querySelector('.cart-items');
  const cartTotal = document.querySelector('.cart-total');
  const themeToggle = document.querySelector('.theme-toggle');
  const body = document.body;
  let checkoutInstance = null;

  const toggleTheme = () => {
    const isDark = body.classList.contains('dark-mode');
    body.classList.toggle('dark-mode', !isDark);
    body.classList.toggle('light-mode', isDark);
    themeToggle.textContent = isDark ? '☀' : '☾';
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

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    body.classList.add('dark-mode');
    body.classList.remove('light-mode');
    themeToggle.textContent = '☀';
  } else {
    body.classList.add('light-mode');
    body.classList.remove('dark-mode');
    themeToggle.textContent = '☾';
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
      cartItems.innerHTML = '<p>Error loading cart. Please try again.</p>';
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
        return alert('Error: Invalid tracklist. Please try again.');
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
            const trackInfo = card.querySelector('.track-info');
            const trackElements = Array.from(card.querySelectorAll('.track-name'));
            trackElements.forEach((name, index) => {
              setTimeout(() => {
                name.classList.remove('locked');
                name.classList.add('purchased', 'animate');
                name.style.fontFamily = 'Arial, sans-serif';
              }, index * 100);
            });
            setTimeout(() => {
              trackElements.forEach((name) => {
                const originalIndex = parseInt(name.dataset.originalIndex);
                name.style.order = originalIndex;
                name.classList.add('reorder');
              });
            }, 200);
            setTimeout(() => {
              fetch('/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  query: `query { tracklists(page: ${new URLSearchParams(window.location.search).get('page') || 1}) { name tracks { name artists release_date } } }`
                }),
                credentials: 'include'
              })
                .then(response => response.json())
                .then(({ data }) => {
                  const tracklist = data.tracklists.find(t => t.name === tracklistName);
                  if (tracklist) {
                    trackElements.forEach((name, index) => {
                      const track = tracklist.tracks.find(t => t.name === name.textContent);
                      if (track) {
                        const artistRelease = document.createElement('p');
                        artistRelease.className = 'artist-release animate';
                        artistRelease.style.order = parseFloat(name.style.order) + 0.5;
                        artistRelease.textContent = `${track.artists.join(', ')} (${track.release_date ? track.release_date.slice(0, 4) : 'Unknown'})`;
                        name.insertAdjacentElement('afterend', artistRelease);
                        setTimeout(() => {
                          artistRelease.classList.add('visible');
                        }, index * 50);
                      }
                    });
                  }
                })
                .catch(error => console.error('Error fetching tracklist for artist-release:', error));
            }, 300);
            button.classList.remove('unlock');
            button.classList.add('unlocked');
            button.textContent = 'Unlocked';
            button.disabled = true;
            setTimeout(() => {
              window.location.reload();
            }, 1200);
          } else {
            console.error('Purchase failed:', result.message);
            if (result.code === 401) {
              window.location.href = `/login?redirect=/tracks?page=${new URLSearchParams(window.location.search).get('page') || 1}`;
            } else {
              alert(result.message || 'Error unlocking tracklist. Please try again.');
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
              alert(result.message || 'Error adding to cart. Please try again.');
            }
          }
        }
      } catch (error) {
        console.error('Network error:', error.message);
        alert('Network error: Unable to connect to the server. Please check your connection and try again.');
      }
    });
  });

  const checkoutCartButton = document.querySelector('.checkout-cart');
  if (checkoutCartButton) {
    checkoutCartButton.addEventListener('click', async () => {
      const page = new URLSearchParams(window.location.search).get('page') || 1;
      const closeModalButton = document.querySelector('.close-modal');
      const checkoutContainer = document.getElementById('checkout-container');
      try {
        if (closeModalButton) closeModalButton.disabled = true;
        checkoutContainer.style.display = 'none';
        if (checkoutInstance) {
          checkoutInstance.unmount();
          checkoutInstance.destroy();
          checkoutInstance = null;
        }
        checkoutCartButton.disabled = true;
        checkoutCartButton.textContent = 'Loading...';
        const response = await fetch(`/checkout?page=${page}`, {
          credentials: 'include'
        });
        const result = await response.json();
        console.log('Checkout response:', result);
        if (response.ok && result.client_secret) {
          checkoutInstance = await stripe.initEmbeddedCheckout({
            clientSecret: result.client_secret
          });
          if (!checkoutInstance || typeof checkoutInstance.mount !== 'function') {
            throw new Error('Invalid checkout instance: Stripe Embedded Checkout failed to initialize.');
          }
          checkoutContainer.style.display = 'block';
          checkoutCartButton.style.display = 'none';
          checkoutInstance.mount('#checkout-container');
        } else {
          console.error('Checkout failed:', result.message);
          if (result.code === 400) {
            alert(result.message || 'No items in cart to checkout. Please add some tracklists first.');
          } else if (result.code === 401) {
            window.location.href = `/login?redirect=/tracks?page=${page}`;
          } else {
            alert(result.message || 'Unable to initiate checkout. Please try again or contact support.');
          }
          checkoutCartButton.disabled = false;
          checkoutCartButton.textContent = 'Checkout';
          if (closeModalButton) closeModalButton.disabled = false;
        }
      } catch (error) {
        console.error('Checkout error:', error.message);
        alert(error.message === 'Invalid checkout instance: Stripe Embedded Checkout failed to initialize.'
          ? 'Failed to initialize Marketplace payment form. Please refresh the page and try again.'
          : 'Unable to connect to the server. Please check your connection and try again.');
        if (checkoutInstance) {
          checkoutInstance.unmount();
          checkoutInstance.destroy();
          checkoutInstance = null;
        }
        checkoutContainer.style.display = 'none';
        checkoutCartButton.style.display = 'block';
        checkoutCartButton.disabled = false;
        checkoutCartButton.textContent = 'Checkout';
        if (closeModalButton) closeModalButton.disabled = false;
      }
    });
  }

  const closeModalButton = document.querySelector('.close-modal');
  if (closeModalButton) {
    closeModalButton.addEventListener('click', () => {
      try {
        // Hide the modal
        cartModal.classList.remove('open');
        
        // Hide and clean up Stripe checkout
        const checkoutContainer = document.getElementById('checkout-container');
        if (checkoutContainer) {
          checkoutContainer.style.display = 'none';
        }
        if (checkoutInstance) {
          checkoutInstance.unmount();
          checkoutInstance.destroy();
          checkoutInstance = null;
        }
        
        // Reset checkout button
        const checkoutCartButton = document.querySelector('.checkout-cart');
        if (checkoutCartButton) {
          checkoutCartButton.style.display = 'block';
          checkoutCartButton.disabled = false;
          checkoutCartButton.textContent = 'Checkout';
        }
        
        // Ensure close button is enabled
        closeModalButton.disabled = false;
      } catch (error) {
        console.error('Error closing cart modal:', error.message);
        alert('Error closing cart. Please try again.');
      }
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
          alert('Error clearing cart: Unable to connect to the server. Please try again.');
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
      alert('Error logging out: Unable to connect to the server. Please try again.');
    }
  });
});
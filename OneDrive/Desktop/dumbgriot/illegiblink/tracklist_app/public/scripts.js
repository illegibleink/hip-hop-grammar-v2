document.addEventListener('DOMContentLoaded', () => {
  const stripe = Stripe(document.body.dataset.stripeKey || '');
  const cartModal = document.querySelector('.cart-modal');
  const cartItems = document.querySelector('.cart-items');
  const cartTotal = document.querySelector('.cart-total');
  const themeToggle = document.querySelector('.theme-toggle');
  const body = document.body;
  let checkoutInstance = null;

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
            const trackInfo = card.querySelector('.track-info');
            // Store original track elements
            const trackElements = Array.from(card.querySelectorAll('.track-name'));
            // Step 1: Animate font transition and unlock
            trackElements.forEach((name, index) => {
              setTimeout(() => {
                name.classList.remove('locked');
                name.classList.add('purchased', 'animate');
                name.style.fontFamily = 'Arial, sans-serif';
              }, index * 100); // Stagger by 100ms per track
            });
            // Step 2: Reorder tracks to original order
            setTimeout(() => {
              trackElements.forEach((name, index) => {
                const originalIndex = parseInt(name.dataset.originalIndex);
                name.style.order = originalIndex;
                name.classList.add('reorder');
              });
            }, 200); // Start reordering after font transition begins
            // Step 3: Insert and animate artist-release
            setTimeout(() => {
              // Fetch original track data to insert artist-release in correct order
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
                        artistRelease.style.order = name.style.order;
                        artistRelease.textContent = `${track.artists.join(', ')} (${track.release_date ? track.release_date.slice(0, 4) : 'Unknown'})`;
                        name.insertAdjacentElement('afterend', artistRelease);
                        setTimeout(() => {
                          artistRelease.classList.add('visible');
                        }, index * 50); // Slight stagger for artist-release
                      }
                    });
                  }
                })
                .catch(error => console.error('Error fetching tracklist for artist-release:', error));
            }, 300); // Start artist-release after reordering
            button.classList.remove('unlock');
            button.classList.add('unlocked');
            button.textContent = 'Unlocked';
            button.disabled = true;
            setTimeout(() => {
              window.location.reload();
            }, 1200); // Delay to allow animations to complete
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
        const checkoutContainer = document.getElementById('checkout-container');
        checkoutContainer.style.display = 'none';
        if (checkoutInstance) {
          checkoutInstance.unmount();
          checkoutInstance.destroy();
          checkoutInstance = null;
        }
        const response = await fetch(`/checkout?page=${page}`, {
          credentials: 'include'
        });
        const result = await response.json();
        console.log('Checkout response:', result);
        if (response.ok) {
          checkoutInstance = await stripe.initEmbeddedCheckout({
            clientSecret: result.client_secret
          });
          checkoutContainer.style.display = 'block';
          checkoutCartButton.style.display = 'none';
          checkoutInstance.mount('#checkout-container');
          checkoutInstance.on('complete', async () => {
            const verifyResponse = await fetch('/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: result.session_id }),
              credentials: 'include'
            });
            const verifyResult = await verifyResponse.json();
            if (verifyResponse.ok && verifyResult.success) {
              checkoutInstance.unmount();
              checkoutInstance.destroy();
              checkoutInstance = null;
              checkoutContainer.style.display = 'none';
              checkoutCartButton.style.display = 'block';
              cartModal.classList.remove('open');
              await updateCart();
              // Animate purchased tracklists
              document.querySelectorAll('.track-card').forEach(card => {
                if (card.querySelector('.unlocked')) {
                  const trackElements = Array.from(card.querySelectorAll('.track-name'));
                  // Font transition and unlock
                  trackElements.forEach((name, index) => {
                    setTimeout(() => {
                      name.classList.remove('locked');
                      name.classList.add('purchased', 'animate');
                      name.style.fontFamily = 'Arial, sans-serif';
                    }, index * 100);
                  });
                  // Reorder tracks
                  setTimeout(() => {
                    trackElements.forEach((name, index) => {
                      const originalIndex = parseInt(name.dataset.originalIndex);
                      name.style.order = originalIndex;
                      name.classList.add('reorder');
                    });
                  }, 200);
                  // Insert and animate artist-release
                  setTimeout(() => {
                    fetch('/graphql', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        query: `query { tracklists(page: ${page}) { name tracks { name artists release_date } } }`
                      }),
                      credentials: 'include'
                    })
                      .then(response => response.json())
                      .then(({ data }) => {
                        const tracklist = data.tracklists.find(t => t.name === card.dataset.tracklistName);
                        if (tracklist) {
                          trackElements.forEach((name, index) => {
                            const track = tracklist.tracks.find(t => t.name === name.textContent);
                            if (track) {
                              const artistRelease = document.createElement('p');
                              artistRelease.className = 'artist-release animate';
                              artistRelease.style.order = name.style.order;
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
                }
              });
              setTimeout(() => {
                window.location.reload();
              }, 1200);
            } else {
              alert(verifyResult.message || 'Payment verification failed');
            }
          });
          checkoutInstance.on('error', (event) => {
            console.error('Checkout error:', event.error);
            alert('Payment failed: ' + event.error.message);
            checkoutInstance.unmount();
            checkoutInstance.destroy();
            checkoutInstance = null;
            checkoutContainer.style.display = 'none';
            checkoutCartButton.style.display = 'block';
          });
          checkoutInstance.on('close', () => {
            checkoutInstance.unmount();
            checkoutInstance.destroy();
            checkoutInstance = null;
            checkoutContainer.style.display = 'none';
            checkoutCartButton.style.display = 'block';
          });
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
        if (checkoutInstance) {
          checkoutInstance.unmount();
          checkoutInstance.destroy();
          checkoutInstance = null;
        }
        checkoutContainer.style.display = 'none';
        checkoutCartButton.style.display = 'block';
      }
    });
  }

  const closeModalButton = document.querySelector('.close-modal');
  if (closeModalButton) {
    closeModalButton.addEventListener('click', () => {
      if (checkoutInstance) {
        checkoutInstance.unmount();
        checkoutInstance.destroy();
        checkoutInstance = null;
      }
      document.getElementById('checkout-container').style.display = 'none';
      document.querySelector('.checkout-cart').style.display = 'block';
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
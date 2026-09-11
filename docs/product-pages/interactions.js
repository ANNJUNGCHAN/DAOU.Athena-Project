const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.product-nav');
function closeMenu() {
  navigation.classList.remove('is-open');
  menuButton.setAttribute('aria-expanded', 'false');
}
menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(expanded));
  navigation.classList.toggle('is-open', expanded);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigation.classList.contains('is-open')) {
    closeMenu();
    menuButton.focus();
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.nav-inner')) closeMenu();
});
matchMedia('(min-width: 701px)').addEventListener('change', closeMenu);

const dialog = document.querySelector('.screen-dialog');
if (dialog) {
  const image = dialog.querySelector('.dialog-image');
  const title = dialog.querySelector('#dialog-title');
  document.querySelectorAll('button.visual').forEach(button => {
    button.addEventListener('click', () => {
      const preview = button.querySelector('img');
      image.src = preview.src;
      image.alt = preview.alt;
      title.textContent = button.dataset.title;
      dialog.showModal();
    });
  });
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

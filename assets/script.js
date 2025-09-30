(function(){
  var root = document.documentElement;
  var body = document.body;
  var burger = document.getElementById('burger');
  var overlay = document.getElementById('mobile-nav');
  var closeBtn = document.getElementById('mobile-close');

  function openNav(){
    root.classList.add('nav-open');
    body.classList.add('nav-open');
    if (burger) burger.setAttribute('aria-expanded','true');
    if (overlay) overlay.removeAttribute('hidden');
  }
  function closeNav(){
    root.classList.remove('nav-open');
    body.classList.remove('nav-open');
    if (burger) burger.setAttribute('aria-expanded','false');
    if (overlay) overlay.setAttribute('hidden','');
  }

  if(burger){
    burger.addEventListener('click', function(){
      var isOpen = root.classList.contains('nav-open');
      if(isOpen){ closeNav(); } else { openNav(); }
    });
  }
  if(closeBtn){
    closeBtn.addEventListener('click', closeNav);
  }

  // Close when clicking a link
  if(overlay){
    overlay.addEventListener('click', function(e){
      if(e.target.closest('a')) closeNav();
    });
  }

  // Close on ESC
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeNav();
  });

  // Prevent touch scroll while open (extra safety)
  ['touchmove','wheel'].forEach(function(evt){
    document.addEventListener(evt, function(e){
      if(root.classList.contains('nav-open')){
        e.preventDefault();
      }
    }, { passive:false });
  });
})();

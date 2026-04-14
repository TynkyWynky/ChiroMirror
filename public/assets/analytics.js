(function () {
  var analyticsMeta = document.querySelector('meta[name="x-analytics-id"]');
  var analyticsId = analyticsMeta && analyticsMeta.getAttribute("content");

  if (!analyticsId) {
    return;
  }

  window.dataLayer = window.dataLayer || [];

  function gtag() {
    window.dataLayer.push(arguments);
  }

  window.gtag = window.gtag || gtag;
  gtag("js", new Date());
  gtag("config", analyticsId);
})();

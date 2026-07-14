/* Line of Sight tool — status: the pill at the top centre (text + spinner). */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});

  const $status = document.getElementById("status");
  const $text = document.getElementById("status-text");

  LOS.status = {
    set(text, loading) {
      $text.textContent = text;
      $status.classList.toggle("loading", !!loading);
    },
  };
})();

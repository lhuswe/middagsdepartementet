/*
 * Packar upp sökvägen som 404.html kodade in i query-strängen.
 *
 * Ligger som egen fil och inte som inline-skript i index.html, av ett enda
 * skäl: ett inline-skript hade tvingat sidans Content Security Policy att
 * tillåta 'unsafe-inline' för script-src, vilket öppnar precis den dörr en CSP
 * finns till för att stänga.
 *
 * Måste köras synkront före appen, så att adressfältet är rätt när React
 * Router läser det.
 */
;(function () {
  var sokning = window.location.search
  if (sokning.indexOf('?/') !== 0) return

  var delar = sokning
    .slice(2)
    .split('&')
    .map(function (del) {
      return del.replace(/~and~/g, '&')
    })

  window.history.replaceState(
    null,
    '',
    window.location.pathname.replace(/\/$/, '') +
      '/' +
      delar[0] +
      (delar[1] ? '?' + delar[1] : '') +
      window.location.hash,
  )
})()

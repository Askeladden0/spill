/**
 * Studilla – krymper bilder i nettleseren før de lastes opp.
 *
 * Spill- og tipsbildene ble lastet opp slik de var, og flere av dem er
 * PNG-er på 1–2,7 MB. Forsiden og tips.html veide dermed over 7 MB på
 * mobil (se EVALUERING.md, D6). Nå skaleres hvert bilde ned til det
 * største det faktisk vises i, og lagres som WebP før opplasting.
 *
 * window.StudillaImage.compress(file, preset) -> Promise<File>
 *   preset: "cover" (spillcover og toppbilde på tips), "content" (bilder
 *   inni et tips) eller "icon" (spillikon). Gir alltid tilbake noe som kan
 *   lastes opp: blir resultatet ikke mindre, eller nettleseren ikke klarer
 *   å lese bildet, kommer originalfilen tilbake uendret.
 */
(function () {
  "use strict";

  const PRESETS = {
    // Coveret vises i full bredde i heltefeltet (ca. 1200 px på desktop).
    cover: { maxWidth: 1200, maxHeight: 1200, quality: 0.8 },
    content: { maxWidth: 1600, maxHeight: 1600, quality: 0.8 },
    // Ikonene vises i 22–44 px; 128 px holder også på skjermer med høy tetthet.
    icon: { maxWidth: 128, maxHeight: 128, quality: 0.9 },
  };

  const INPUT_TYPES = /^image\/(png|jpeg|webp)$/;

  async function decode(blob) {
    if (window.createImageBitmap) {
      try {
        const bitmap = await createImageBitmap(blob);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
      } catch (e) {
        // Faller videre til <img> under.
      }
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function hasTransparency(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  }

  function renamed(name, type) {
    const ext = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[type];
    return String(name || "bilde").replace(/\.[a-z0-9]+$/i, "") + "." + ext;
  }

  async function compress(file, preset) {
    const opts = PRESETS[preset] || PRESETS.cover;
    if (!file || !INPUT_TYPES.test(file.type)) return file;

    let decoded;
    try {
      decoded = await decode(file);
    } catch (e) {
      return file;
    }

    const scale = Math.min(1, opts.maxWidth / decoded.width, opts.maxHeight / decoded.height);
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, w, h);
    decoded.done();

    let blob = await toBlob(canvas, "image/webp", opts.quality);
    // Nettlesere som ikke kan lage WebP (eldre Safari), gir en PNG i stedet.
    // Da blir det JPEG – med mindre bildet har gjennomsiktige områder.
    if (!blob || blob.type !== "image/webp") {
      blob = hasTransparency(ctx, w, h)
        ? await toBlob(canvas, "image/png")
        : await toBlob(canvas, "image/jpeg", opts.quality);
    }

    if (!blob || blob.size >= file.size) return file;
    return new File([blob], renamed(file.name, blob.type), { type: blob.type });
  }

  window.StudillaImage = { compress, PRESETS };
})();

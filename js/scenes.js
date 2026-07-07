/* Built-in demo scenes — photos from Unsplash, served locally from assets/.
   Chosen to showcase different symptom groups:
   sky   → snow over a bright uniform field, photophobia, the sun's halo
   night → halos & starbursts on street lights, impaired night vision
   page  → the reading struggle: snow, trailing and ghosting over text */

const Scenes = (() => {
  const DEFS = {
    sky:   { src: "assets/sky.jpg",   credit: "Soham Banerjee" },   // sunny mountain landscape
    night: { src: "assets/night.jpg", credit: "H&CO" },
    page:  { src: "assets/page.jpg",  credit: "Brett Jordan" },
    // VSS doesn't stop when the eyes close — snow crawls over the dark.
    // Not quite pure black: closed eyelids still pass a hint of light.
    eyes:  { make(){
      const c = document.createElement("canvas");
      c.width = 256; c.height = 192;
      const ctx = c.getContext("2d");
      const g = ctx.createRadialGradient(128, 96, 10, 128, 96, 190);
      g.addColorStop(0, "#0b0a0c");
      g.addColorStop(1, "#040305");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 192);
      return c;
    }},
  };
  const cache = {};

  function get(name){
    if(!cache[name]){
      const def = DEFS[name];
      if(def.make){
        cache[name] = Promise.resolve(def.make());
      } else {
        cache[name] = new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => {
            delete cache[name];          // allow a retry later
            reject(new Error("Couldn't load the scene image (" + def.src + ")."));
          };
          img.src = def.src;
        });
      }
    }
    return cache[name];
  }

  return { get, DEFS };
})();

"use client";

import React, { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

export default function MinimalHero() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const setSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setSize();

    type Particle = {
      x: number;
      y: number;
      speed: number;
      opacity: number;
      fadeDelay: number;
      fadeStart: number;
      fadingOut: boolean;
    };

    let particles: Particle[] = [];
    let raf = 0;

    const count = () => Math.floor((canvas.width * canvas.height) / 7000);

    const make = (): Particle => {
      const fadeDelay = Math.random() * 600 + 100;
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: Math.random() / 5 + 0.1,
        opacity: 0.9,
        fadeDelay,
        fadeStart: Date.now() + fadeDelay,
        fadingOut: false,
      };
    };

    const reset = (p: Particle) => {
      p.x = Math.random() * canvas.width;
      p.y = Math.random() * canvas.height;
      p.speed = Math.random() / 5 + 0.1;
      p.opacity = 0.9;
      p.fadeDelay = Math.random() * 600 + 100;
      p.fadeStart = Date.now() + p.fadeDelay;
      p.fadingOut = false;
    };

    const init = () => {
      particles = [];
      for (let i = 0; i < count(); i++) particles.push(make());
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.y -= p.speed;
        if (p.y < 0) reset(p);
        if (!p.fadingOut && Date.now() > p.fadeStart) p.fadingOut = true;
        if (p.fadingOut) {
          p.opacity -= 0.008;
          if (p.opacity <= 0) reset(p);
        }
        // Increased whiteness and size for better visibility
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity * 0.8})`;
        ctx.fillRect(p.x, p.y, 1.5, Math.random() * 3 + 1);
      });
      raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      setSize();
      init();
    };

    window.addEventListener("resize", onResize);
    init();
    raf = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  const scrollToAnalyzer = () => {
    document.getElementById("analyzer-section")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <>
      <div className="fixed inset-0 z-[-1] pointer-events-none">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-80" />
        <div className="absolute inset-0 mask-fade-out">
          <div className="animated-line hline" />
          <div className="animated-line hline" />
          <div className="animated-line hline" />
          <div className="animated-line vline" />
          <div className="animated-line vline" />
          <div className="animated-line vline" />
        </div>
      </div>

      <section className="relative w-full h-screen flex flex-col items-center justify-center text-center px-4">
        <div className="animate-slide-up flex flex-col items-center max-w-4xl mx-auto">
          <h1 className="text-7xl md:text-[9rem] leading-none font-bold tracking-tighter text-foreground font-sans">
            CLARIX
          </h1>
          <p className="mt-8 text-lg md:text-2xl text-foreground font-semibold uppercase tracking-[0.25em]">
            Verify Anything, Instantly.
          </p>
          <p className="mt-6 text-muted-foreground text-base md:text-lg max-w-2xl leading-relaxed">
            An advanced AI-powered engine designed to fact-check claims, analyze media, and scan full web pages for misinformation in real-time.
          </p>
          <button 
            onClick={scrollToAnalyzer}
            className="mt-16 group flex flex-col items-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-[11px] tracking-widest uppercase mb-3 font-semibold">Explore Engine</span>
            <ChevronDown className="h-5 w-5 animate-bounce" />
          </button>
        </div>
      </section>

      {/* Embedded CSS for animations and lines */}
      <style dangerouslySetInnerHTML={{ __html: `
        .mask-fade-out {
          mask-image: radial-gradient(circle at center, black 30%, transparent 80%);
          -webkit-mask-image: radial-gradient(circle at center, black 30%, transparent 80%);
        }
        .animated-line {
          position: absolute;
          background: rgba(255, 255, 255, 0.15);
          will-change: transform, opacity;
        }
        .hline {
          height: 1px; left: 0; right: 0;
          transform: scaleX(0);
          transform-origin: 50% 50%;
          animation: drawX 1200ms cubic-bezier(.22,.61,.36,1) forwards;
        }
        .hline:nth-child(1){ top: 25%; animation-delay: 100ms; }
        .hline:nth-child(2){ top: 50%; animation-delay: 250ms; }
        .hline:nth-child(3){ top: 75%; animation-delay: 400ms; }

        .vline {
          width: 1px; top: 0; bottom: 0;
          transform: scaleY(0);
          transform-origin: 50% 0%;
          animation: drawY 1200ms cubic-bezier(.22,.61,.36,1) forwards;
        }
        .vline:nth-child(4){ left: 25%; animation-delay: 400ms; }
        .vline:nth-child(5){ left: 50%; animation-delay: 550ms; }
        .vline:nth-child(6){ left: 75%; animation-delay: 700ms; }

        @keyframes drawX {
          0% { transform: scaleX(0); opacity: 0; }
          100% { transform: scaleX(1); opacity: 1; }
        }
        @keyframes drawY {
          0% { transform: scaleY(0); opacity: 0; }
          100% { transform: scaleY(1); opacity: 1; }
        }
      `}} />
    </>
  );
}

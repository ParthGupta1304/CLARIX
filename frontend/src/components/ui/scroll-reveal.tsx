"use client";

import React from "react";
import { motion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";

type Direction = "up" | "down" | "left" | "right";

interface ScrollRevealProps {
  children: React.ReactNode;
  direction?: Direction;
  delay?: number;
  duration?: number;
  blur?: boolean;
  className?: string;
  once?: boolean;
}

const getVariants = (direction: Direction, blur: boolean): Variants => {
  const offsets: Record<Direction, { x: number; y: number }> = {
    up: { x: 0, y: 40 },
    down: { x: 0, y: -40 },
    left: { x: 40, y: 0 },
    right: { x: -40, y: 0 },
  };

  return {
    hidden: {
      opacity: 0,
      x: offsets[direction].x,
      y: offsets[direction].y,
      filter: blur ? "blur(8px)" : "blur(0px)",
    },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      filter: "blur(0px)",
    },
  };
};

export function ScrollReveal({
  children,
  direction = "up",
  delay = 0,
  duration = 0.6,
  blur = true,
  className,
  once = true,
}: ScrollRevealProps) {
  return (
    <motion.div
      variants={getVariants(direction, blur)}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: "-80px" }}
      transition={{
        duration,
        delay,
        ease: [0.22, 0.61, 0.36, 1],
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}

/* Stagger container — wraps children whose stagger delay auto-increments */
interface StaggerContainerProps {
  children: React.ReactNode;
  stagger?: number;
  className?: string;
}

const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.12,
    },
  },
};

export function StaggerContainer({
  children,
  stagger = 0.12,
  className,
}: StaggerContainerProps) {
  return (
    <motion.div
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: stagger } },
      }}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}

/* Individual stagger child */
interface StaggerItemProps {
  children: React.ReactNode;
  direction?: Direction;
  blur?: boolean;
  className?: string;
}

export function StaggerItem({
  children,
  direction = "up",
  blur = true,
  className,
}: StaggerItemProps) {
  return (
    <motion.div
      variants={getVariants(direction, blur)}
      transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}

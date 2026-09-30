/**
 * TechVeille Hub — Vercel Web Analytics
 * Initialise le suivi analytique pour mesurer les performances et l'engagement.
 * 
 * Note: Utilise l'import depuis un CDN ESM compatible car @vercel/analytics
 * est conçu pour être utilisé avec un bundler. Cette approche permet d'utiliser
 * le package directement dans le navigateur sans étape de build.
 */

import { inject } from 'https://cdn.jsdelivr.net/npm/@vercel/analytics@2/+esm';

// Injecte le script d'analyse Vercel
// Le mode est automatiquement détecté (production vs development)
inject();

console.log('[analytics] Vercel Web Analytics initialisé');

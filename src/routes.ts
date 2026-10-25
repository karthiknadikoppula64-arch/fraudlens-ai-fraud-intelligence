/**
 * Route table. Navigation is state-based (activeTab) and kept in sync with the URL path
 * via the History API, so /overview, /stream, ... are deep-linkable and back/forward work.
 */
export type NavTabId =
  | 'overview'
  | 'dataset'
  | 'stream'
  | 'manual'
  | 'models'
  | 'shap'
  | 'drift'
  | 'delayed'
  | 'queue'
  | 'methodology'
  | 'about';

export const PRODUCT_TITLE = 'AI Fraud Intelligence';
export const APP_NAME = 'FraudLens';
export const TAGLINE = 'Intelligent Fraud Detection. Explainable Decisions. Real-Time Protection.';

export interface RouteMeta {
  path: string;
  title: string;
  navLabel: string;
  subtitle: string;
}

export const ROUTES: Record<NavTabId, RouteMeta> = {
  overview: { path: '/overview', title: 'Executive Overview', navLabel: 'Executive Overview', subtitle: 'Digital banking view and fraud intelligence command center, computed from the active dataset and trained models.' },
  dataset: { path: '/dataset', title: 'Dataset and Ingestion', navLabel: 'Dataset & Ingestion', subtitle: 'CSV upload, column validation, privacy filtering and chronological 60/20/20 splits.' },
  stream: { path: '/stream', title: 'Real-Time Stream and Live Scoring', navLabel: 'Real-Time Stream', subtitle: 'Chronological replay of the held-out test split, or a clearly labelled synthetic stream, scored live by the active model.' },
  manual: { path: '/manual', title: 'Manual Transaction', navLabel: 'Manual Transaction', subtitle: 'Enter one transaction and score it with the active trained model at the tuned threshold. Manual tests are never labelled, trained on or evaluated.' },
  models: { path: '/models', title: 'Model Benchmarking and Cost-Sensitive Tuning', navLabel: 'Model Benchmarking', subtitle: 'Models trained on the train split, thresholds tuned on validation, metrics reported on the held-out test split.' },
  shap: { path: '/shap', title: 'SHAP Explanations and Local Attribution', navLabel: 'SHAP Explanations', subtitle: 'Global feature importance and per-transaction additive attributions from the active model.' },
  drift: { path: '/drift', title: 'Confidence-Bounded Drift Monitoring', navLabel: 'Drift Monitoring', subtitle: 'Explanation drift flagged only when it exceeds expected sampling variation.' },
  delayed: { path: '/delayed', title: 'Delayed-Label Evaluation', navLabel: 'Delayed-Label Evaluation', subtitle: 'How apparent performance changes while chargeback labels are still maturing (simulated lags).' },
  queue: { path: '/queue', title: 'Limited Review Queue Simulator', navLabel: 'Review Queue Simulator', subtitle: 'Simulation / demo: step through the active model’s test-split alerts with simulated reviewer decisions, and see how daily analyst capacity limits recovery.' },
  methodology: { path: '/methodology', title: 'Methodology and Limitations', navLabel: 'Methodology & Limitations', subtitle: 'Data, features, models, time-aware evaluation, metrics, delayed labels and drift, and the prototype’s limitations.' },
  about: { path: '/about', title: 'Technical Details', navLabel: 'Technical Details', subtitle: 'Architecture, technology stack, models and local setup.' },
};

export const NAV_ORDER: NavTabId[] = ['overview', 'dataset', 'stream', 'manual', 'models', 'shap', 'drift', 'delayed', 'queue', 'methodology', 'about'];

export interface NavGroup {
  id: string;
  label: string;
  items: NavTabId[];
  /** Secondary groups render smaller, after the main navigation. */
  secondary?: boolean;
}

/** Sidebar grouping. Every tab appears exactly once (asserted in routes.test.ts). */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'home', label: 'Home', items: ['overview'] },
  { id: 'testing', label: 'Transaction testing', items: ['stream', 'manual'] },
  { id: 'data', label: 'Dataset', items: ['dataset'] },
  { id: 'detection', label: 'Detection', items: ['models', 'shap'] },
  { id: 'evaluation', label: 'Evaluation', items: ['drift', 'delayed'] },
  { id: 'review', label: 'Review', items: ['queue'] },
  { id: 'reference', label: 'Reference', items: ['methodology', 'about'], secondary: true },
];

export function pathToTab(pathname: string): NavTabId | null {
  const clean = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  if (clean === '/') return 'overview';
  if (clean === '/transactions') return 'stream';
  if (clean === '/workbench') return 'queue';
  const hit = NAV_ORDER.find((id) => ROUTES[id].path === clean);
  return hit ?? null;
}

export function documentTitle(tab: NavTabId): string {
  return `${ROUTES[tab].title} · ${APP_NAME} | ${PRODUCT_TITLE}`;
}

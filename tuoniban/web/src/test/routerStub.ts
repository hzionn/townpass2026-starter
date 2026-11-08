import { createMemoryHistory, createRouter, type Router } from 'vue-router';

const Blank = { render: () => null };

/** A router with every app path, where each page is blank: for mounting one view on its own. */
export function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Blank },
      { path: '/scan', component: Blank },
      { path: '/assist', component: Blank },
      { path: '/my-assistance', component: Blank },
      { path: '/cases/:id/:page', component: Blank },
    ],
  });
}

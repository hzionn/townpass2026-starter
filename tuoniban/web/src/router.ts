import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import type { Persona } from '../../shared/contract';
import { focusPageHeading } from './lib/focus';
import { pageTitle } from './lib/pageTitle';
import { refreshSession, session } from './stores/session';
import Assist from './views/Assist.vue';
import CaseEdit from './views/CaseEdit.vue';
import CaseResult from './views/CaseResult.vue';
import CaseReview from './views/CaseReview.vue';
import Home from './views/Home.vue';
import MyAssistance from './views/MyAssistance.vue';
import Scan from './views/Scan.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** Shown in document.title, which is also what TownPass's app bar displays. */
    title?: string;
    /** The demo persona this page needs. Pages without one are open to anybody. */
    persona?: Persona;
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', component: Home, meta: { title: '你想怎麼使用？' } },
  { path: '/my-assistance', component: MyAssistance, meta: { title: '我的協助碼', persona: 'applicant' } },
  { path: '/scan', component: Scan, meta: { title: '掃碼開始協助', persona: 'helper' } },
  { path: '/assist', component: Assist, meta: { title: '正在開啟協助' } },
  { path: '/cases/:id/edit', component: CaseEdit, props: true, meta: { title: '協助填寫需求', persona: 'helper' } },
  { path: '/cases/:id/review', component: CaseReview, props: true, meta: { title: '確認這次需求', persona: 'helper' } },
  { path: '/cases/:id/result', component: CaseResult, props: true, meta: { title: '模擬送出完成', persona: 'helper' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const required = to.meta.persona;
  if (!required) return true;
  if (session.value?.persona === required) return true;
  try {
    const current = await refreshSession();
    return current?.persona === required ? true : '/';
  } catch {
    // The server cannot be reached: let the page load so it can offer its own retry.
    return true;
  }
});

router.afterEach((to) => {
  document.title = pageTitle(to.meta.title);
  focusPageHeading();
});

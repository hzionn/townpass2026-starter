import { createApp } from 'vue';
import App from './App.vue';
import { setAccessLostHandler } from './api/client';
import { router } from './router';
import { forgetSession } from './stores/session';
import './styles/main.css';

// Spec §10.1: a lost session returns to the shared entry page, from any screen.
setAccessLostHandler(() => {
  forgetSession();
  void router.replace('/');
});

createApp(App).use(router).mount('#app');

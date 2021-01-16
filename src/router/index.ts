import Vue from 'vue'
import VueRouter from 'vue-router'

Vue.use(VueRouter)

const router = new VueRouter({
  mode: 'hash',
  routes: [
    {
      path: '/',
      redirect: '/random'
    },
    {
      path: '/extra',
      component: () => import('@/views/Extra.vue')
    },
    {
      path: '/hanzi',
      component: () => import('@/views/Hanzi.vue')
    },
    {
      path: '/level',
      component: () => import('@/views/Level.vue')
    },
    {
      path: '/library',
      component: () => import('@/views/Library.vue')
    },
    {
      path: '/quiz',
      component: () => import('@/views/Quiz.vue')
    },
    {
      path: '/random',
      component: () => import('@/views/Random.vue')
    },
    {
      path: '/sentence',
      component: () => import('@/views/Sentence.vue')
    },
    {
      path: '/settings',
      component: () => import('@/views/Settings.vue')
    },
    {
      path: '/vocab',
      component: () => import('@/views/Vocab.vue')
    }
  ]
})

export default router

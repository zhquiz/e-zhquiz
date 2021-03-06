<template>
  <section>
    <div v-if="isInit" class="QuizPage">
      <div class="columns" style="flex-wrap: wrap">
        <div class="column is-4-fullhd is-6">
          <div class="field">
            <label class="label">Type</label>
            <b-field class="flex-wrap">
              <b-checkbox-button
                v-model="type"
                native-value="hanzi"
                type="is-success"
              >
                Hanzi
              </b-checkbox-button>
              <b-checkbox-button
                v-model="type"
                native-value="vocab"
                type="is-success"
              >
                Vocab
              </b-checkbox-button>
              <b-checkbox-button
                v-model="type"
                native-value="sentence"
                type="is-success"
              >
                Sentence
              </b-checkbox-button>
            </b-field>
          </div>
        </div>
        <div class="column is-4-fullhd is-6">
          <div class="field">
            <label class="label">Learning stage</label>
            <b-field class="flex-wrap">
              <b-checkbox-button
                v-model="stage"
                native-value="new"
                type="is-success"
              >
                New
              </b-checkbox-button>
              <b-checkbox-button
                v-model="stage"
                native-value="leech"
                type="is-success"
              >
                Leech
              </b-checkbox-button>
              <b-checkbox-button
                v-model="stage"
                native-value="learning"
                type="is-success"
              >
                Learning
              </b-checkbox-button>
              <b-checkbox-button
                v-model="stage"
                native-value="graduated"
                type="is-success"
              >
                Graduated
              </b-checkbox-button>
            </b-field>
          </div>
        </div>
        <div class="column is-4-fullhd is-6">
          <div class="field">
            <label class="label">Extras</label>
            <div class="control">
              <b-switch v-model="includeExtra">User items</b-switch>
              <b-switch v-model="includeUndue">Include undue</b-switch>
            </div>
          </div>
        </div>
        <div class="column is-6">
          <div class="field">
            <label class="label">Direction</label>
            <b-field class="flex-wrap">
              <b-checkbox-button
                v-model="direction"
                native-value="se"
                type="is-success"
              >
                Simplified-English
              </b-checkbox-button>
              <b-checkbox-button
                v-model="direction"
                native-value="te"
                type="is-success"
              >
                Traditional-English
              </b-checkbox-button>
              <b-checkbox-button
                v-model="direction"
                native-value="ec"
                type="is-success"
              >
                English-Chinese
              </b-checkbox-button>
            </b-field>
          </div>
        </div>
        <div class="column">
          <form @submit.prevent="reload">
            <b-field label="Filter">
              <b-input
                v-model="q"
                placeholder="Try level:10 or tag:HSK4"
                type="search"
              />
            </b-field>
          </form>
        </div>
      </div>

      <b-collapse class="card" animation="slide" :open="isQuizDashboardReady">
        <div
          slot="trigger"
          slot-scope="props"
          class="card-header"
          role="button"
        >
          <p class="card-header-title">Quiz</p>
          <a role="button" class="card-header-icon">
            <fontawesome :icon="props.open ? 'caret-down' : 'caret-up'" />
          </a>
        </div>
        <div class="card-content">
          <div class="columns">
            <div class="column is-3">
              <div v-if="includeUndue">
                <span class="column-label">Pending: </span>
                <span>{{ quizArray.length | format }}</span>
              </div>
              <div v-else-if="dueItems.length">
                <span class="column-label">Due: </span>
                <span>{{ dueItems.length | format }}</span>
              </div>
              <div v-else-if="dueIn">
                <span class="column-label">Due in: </span>
                <span>{{ dueIn | duration }}</span>
              </div>
              <div v-else>
                <span>No items due</span>
              </div>
            </div>

            <div class="column is-3">
              <span class="column-label">New: </span>
              <span>{{ newItems.length | format }}</span>
            </div>
            <div class="column is-3">
              <span class="column-label">Leech: </span>
              <span>{{ leechItems.length | format }}</span>
            </div>
            <div class="column is-3 flex flex-row">
              <div class="flex-grow" />
              <b-button
                type="is-success"
                :disabled="quizArray.length === 0"
                @click="startQuiz"
              >
                Start Quiz
              </b-button>
            </div>
          </div>
        </div>
      </b-collapse>

      <QuizCard ref="quizCard" :quiz-array="quizArray" @quiz:ended="reload" />

      <b-loading :active="isLoading" />
    </div>
  </section>
</template>

<script lang="ts">
import { Component, Ref, Vue, Watch } from 'vue-property-decorator'

import QuizCard, { IQuizData, IQuizType } from '@/components/QuizCard.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import { api } from '@/assets/api'

@Component<QuizPage>({
  components: {
    QuizCard,
    ContextMenu
  },
  async created () {
    const r = await api
      .get<{
        'settings.quiz': {
          type: IQuizType[];
          stage: string[];
          direction: string[];
          includeUndue: boolean;
          includeExtra: boolean;
        };
      }>('/api/user', {
        params: {
          select: ['settings.quiz']
        }
      })
      .then((r) => r.data)

    const { type, stage, direction, includeUndue, includeExtra } =
      r['settings.quiz'] || {}

    if (type) {
      this.type = type
    }

    if (stage) {
      this.stage = stage
    }

    if (direction) {
      this.direction = direction
    }

    if (typeof includeUndue === 'boolean') {
      this.includeUndue = includeUndue
    }

    if (typeof includeExtra === 'boolean') {
      this.includeExtra = includeExtra
    }

    await this.init()
    this.isQuizDashboardReady = true
  }
})
export default class QuizPage extends Vue {
  @Ref() quizCard!: QuizCard

  isLoading = false
  isInit = false
  isQuizDashboardReady = false

  q = ''

  type: IQuizType[] = ['hanzi', 'vocab', 'sentence']
  stage = ['new', 'leech', 'learning']
  direction = ['se']

  includeExtra = true
  includeUndue = false

  dueIn: Date | null = null

  quizArray: string[] = []

  quizData: {
    [quizId: string]: IQuizData;
  } = {}

  cache: {
    now: number;
  } = {
    now: +new Date()
  }

  get backlogItems () {
    this.cache.now = +new Date()
    return this.quizArray.filter((id) => {
      const d = this.quizData[id]
      return d && d.nextReview && +new Date(d.nextReview) < this.cache.now
    })
  }

  get dueItems () {
    return [...this.backlogItems, ...this.newItems]
  }

  get newItems () {
    return this.quizArray.filter((id) => {
      const d = this.quizData[id]
      return d && typeof d.srsLevel !== 'number'
    })
  }

  get leechItems () {
    return this.quizArray.filter((id) => {
      const d = this.quizData[id]
      return d && d.wrongStreak && d.wrongStreak > 2
    })
  }

  async init () {
    const r = await api
      .get('/api/user', {
        params: {
          select: ['settings.quiz']
        }
      })
      .then((r) => r.data)

    const { type, stage, direction, includeExtra, includeUndue } =
      r['settings.quiz'] || {}

    if (type) {
      this.$set(this, 'type', type)
    }

    if (stage) {
      this.$set(this, 'stage', stage)
    }

    if (direction) {
      this.$set(this, 'direction', direction)
    }

    if (typeof includeExtra !== 'undefined') {
      this.$set(this, 'includeExtra', includeExtra)
    }

    if (typeof includeUndue !== 'undefined') {
      this.$set(this, 'includeUndue', includeUndue)
    }

    this.isInit = true
    this.isLoading = false

    await this.reload()
  }

  @Watch('type', { deep: true })
  @Watch('stage', { deep: true })
  @Watch('direction', { deep: true })
  @Watch('includeUndue')
  @Watch('includeExtra')
  async reload () {
    const {
      quiz,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upcoming: [{ nextReview: dueIn } = {} as any] = []
    } = await api
      .get<{
        quiz: IQuizData[];
        upcoming: IQuizData[];
      }>('/api/quiz/init', {
        params: {
          type: this.type,
          stage: this.stage,
          direction: this.direction,
          includeUndue: this.includeUndue,
          includeExtra: this.includeExtra,
          q: this.q
        }
      })
      .then((r) => r.data)

    const quizArray: string[] = []
    // eslint-disable-next-line array-callback-return,@typescript-eslint/no-explicit-any
    quiz.map((it: any) => {
      quizArray.push(it.id)
      this.quizData[it.id] = it
    })

    this.$set(this, 'quizArray', quizArray)
    this.$set(this, 'quizData', this.quizData)

    this.dueIn = dueIn ? new Date(dueIn) : null
  }

  async startQuiz () {
    await this.quizCard.startQuiz()
  }
}
</script>

<style scoped>
.card {
  margin-bottom: 1rem;
}

.column-label {
  width: 5rem;
}

.taginput-field {
  padding-top: 1em;
  display: flex;
  flex-direction: row-reverse;
}

.quiz-modal .modal-content {
  max-width: 500px !important;
}

.quiz-modal .buttons-area {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  padding-top: 1rem;
  padding-bottom: 1rem;
}

.buttons-area .buttons {
  margin-bottom: 0;
}

.quiz-modal .card-content {
  min-height: 7.5rem;
  max-height: calc(100vh - 300px);
  overflow: scroll;
  padding-bottom: 0;
  padding-left: 0;
  padding-right: 0;
  margin-left: 1.5rem;
  margin-right: 1.5rem;
  border-bottom: 1px solid hsla(0, 0%, 50%, 0.25);
}

.buttons-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.buttons-panel .buttons {
  margin-bottom: 0;
}

.buttons-area button::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background-color: currentColor;
  visibility: hidden;
  z-index: 2;
}

.buttons-area button:not(:active)::before {
  animation: ripple 0.4s cubic-bezier(0, 0, 0.2, 1);
  transition: visibility 0.4s step-end;
}

.buttons-area button:active::before {
  visibility: visible;
}

.edit-modal .card-footer {
  padding: 1rem;
}

@keyframes ripple {
  0% {
    width: 0;
    height: 0;
    opacity: 0.5;
  }
  100% {
    width: 150px;
    height: 150px;
    opacity: 0;
  }
}
</style>

// Static demo content for the seed. Topic tags here are the shared vocabulary used by
// lessons, exam questions, the cognitive item bank (ml-service) and recommendations.

import type { CourseLevel, LessonFormat } from '@prisma/client';

export type SeedLesson = {
  title: string;
  summary: string;
  format: LessonFormat;
  difficulty: number;
  durationMinutes: number;
  topics: string[];
  content: string;
};

export type SeedModule = { title: string; description: string; lessons: SeedLesson[] };

export type SeedQuestion = {
  prompt: string;
  options: string[];
  correct: number[];
  topic: string;
  difficulty: number;
  explanation: string;
};

export type SeedExam = {
  title: string;
  description: string;
  durationMinutes: number;
  proctored: boolean;
  passingScore: number;
  questions: SeedQuestion[];
};

export type SeedCourse = {
  title: string;
  description: string;
  level: CourseLevel;
  tags: string[];
  accent: string;
  published: boolean;
  modules: SeedModule[];
  exams: SeedExam[];
};

export const dataScienceCourse: SeedCourse = {
  title: 'Foundations of Data Science',
  description:
    'Learn to reason with data: collect it, summarize it, quantify uncertainty, visualize it honestly and build your first predictive model.',
  level: 'BEGINNER',
  tags: ['data', 'statistics', 'python-free'],
  accent: 'indigo',
  published: true,
  modules: [
    {
      title: 'Thinking with Data',
      description: 'What data science is, what data looks like, and how to ask questions data can answer.',
      lessons: [
        {
          title: 'What is data science?',
          summary: 'The questions, workflow and roles behind the buzzword.',
          format: 'READING',
          difficulty: 1,
          durationMinutes: 8,
          topics: ['data-literacy'],
          content: `## What is data science?

Data science is the practice of **turning raw observations into decisions**. It borrows from statistics (quantifying uncertainty), computing (handling data at scale) and domain knowledge (knowing which questions matter).

### The workflow
1. **Ask** a question that data could plausibly answer.
2. **Collect** or locate the data.
3. **Clean** it: fix types, handle missing values, remove duplicates.
4. **Explore** with summaries and charts.
5. **Model** relationships, if the question needs prediction or explanation.
6. **Communicate** results, including their limits.

> Most real projects spend more time on steps 2–4 than on modeling.

### Check yourself
Think of a decision you made this week. What data, if you'd had it, would have changed it?`,
        },
        {
          title: 'Types of data',
          summary: 'Numerical vs categorical, and why the distinction drives every later choice.',
          format: 'VIDEO',
          difficulty: 1,
          durationMinutes: 10,
          topics: ['data-literacy'],
          content: `## Types of data (video transcript)

Every column in a dataset has a **type**, and the type decides which summaries and charts make sense.

- **Numerical, continuous**: height, temperature, time on task. Can take any value in a range.
- **Numerical, discrete**: number of siblings, clicks. Counts.
- **Categorical, nominal**: country, favourite colour. No natural order.
- **Categorical, ordinal**: survey ratings (poor → excellent). Ordered, but gaps aren't equal.

A classic mistake is averaging ordinal codes: the "average" of *poor=1* and *excellent=5* is not "fair".`,
        },
        {
          title: 'Asking good questions',
          summary: 'Practice turning vague curiosity into answerable, measurable questions.',
          format: 'INTERACTIVE',
          difficulty: 2,
          durationMinutes: 12,
          topics: ['data-literacy', 'critical-thinking'],
          content: `## Asking good questions

A good data question is **specific**, **measurable**, and **actionable**.

| Vague | Answerable |
|---|---|
| Are students engaged? | What share of enrolled students open at least one lesson per week? |
| Is the new layout better? | Does the new layout change the 7-day completion rate by more than 2 points? |

### Try it
Rewrite each of these as an answerable question:
1. *Do people like our app?*
2. *Is traffic bad downtown?*

For each, name the **unit of observation**, the **measurement**, and the **comparison**.`,
        },
      ],
    },
    {
      title: 'Probability & Statistics',
      description: 'Summarize data and reason about uncertainty.',
      lessons: [
        {
          title: 'Descriptive statistics',
          summary: 'Center, spread and shape: mean, median, standard deviation, skew.',
          format: 'READING',
          difficulty: 2,
          durationMinutes: 12,
          topics: ['statistics'],
          content: `## Descriptive statistics

**Center**
- *Mean*: sum ÷ count. Sensitive to outliers.
- *Median*: middle value when sorted. Robust to outliers.

**Spread**
- *Range*: max − min.
- *Standard deviation*: typical distance from the mean.
- *IQR*: spread of the middle 50%.

**Shape**
When a few very large values pull the mean above the median, the distribution is **right-skewed** (incomes, house prices). Report the median for skewed data.`,
        },
        {
          title: 'Probability basics',
          summary: 'Events, independence and the rules that combine them.',
          format: 'VIDEO',
          difficulty: 2,
          durationMinutes: 14,
          topics: ['probability'],
          content: `## Probability basics (video transcript)

A probability is a number between 0 and 1 describing how likely an event is.

- **Complement**: P(not A) = 1 − P(A)
- **Addition**: P(A or B) = P(A) + P(B) − P(A and B)
- **Independence**: A and B are independent if P(A and B) = P(A)·P(B)

Two fair coin flips are independent: P(two heads) = 0.5 × 0.5 = 0.25.

**Conditional probability** P(A | B) is the probability of A *given* that B happened: P(A and B) / P(B).`,
        },
        {
          title: 'Distributions in practice',
          summary: 'Normal, binomial and uniform distributions with worked examples.',
          format: 'INTERACTIVE',
          difficulty: 3,
          durationMinutes: 15,
          topics: ['probability', 'statistics'],
          content: `## Distributions in practice

- **Uniform**: every outcome equally likely (a fair die).
- **Binomial**: number of successes in *n* independent yes/no trials (free throws made out of 10).
- **Normal**: the bell curve; sums of many small independent effects tend toward it.

### The 68–95–99.7 rule
For normal data, about 68% lies within 1 SD of the mean, 95% within 2 SD, 99.7% within 3 SD.

**Exercise:** exam scores are roughly normal with mean 70, SD 8. About what share of students scored above 86?`,
        },
        {
          title: 'Sampling and bias',
          summary: 'Why who you ask matters more than how many you ask.',
          format: 'READING',
          difficulty: 3,
          durationMinutes: 10,
          topics: ['statistics', 'critical-thinking'],
          content: `## Sampling and bias

A **sample** is useful only if it represents the **population** you care about.

Common biases:
- **Selection bias**: an online poll only reaches people online.
- **Survivorship bias**: studying only companies that still exist.
- **Non-response bias**: the people who reply differ from those who don't.

A large biased sample is *worse* than a small random one: it gives a confident wrong answer.`,
        },
      ],
    },
    {
      title: 'Visualizing & Modeling',
      description: 'Show data honestly and make your first predictions.',
      lessons: [
        {
          title: 'Principles of visualization',
          summary: 'Encodings, honesty and reducing clutter.',
          format: 'VIDEO',
          difficulty: 2,
          durationMinutes: 11,
          topics: ['visualization'],
          content: `## Principles of visualization (video transcript)

1. **Position beats color**: people compare positions on a common axis most accurately.
2. **Start bar charts at zero**: bar length encodes the value.
3. **Remove chart junk**: every ink mark should carry information.
4. **Label directly** where possible instead of relying on legends.`,
        },
        {
          title: 'Choosing the right chart',
          summary: 'Match the chart to the question: comparison, trend, distribution or relationship.',
          format: 'INTERACTIVE',
          difficulty: 3,
          durationMinutes: 12,
          topics: ['visualization'],
          content: `## Choosing the right chart

| Question | Chart |
|---|---|
| Compare categories | Bar chart |
| Change over time | Line chart |
| Distribution of one variable | Histogram / box plot |
| Relationship between two numbers | Scatter plot |

**Exercise:** you want to show how weekly active users changed over the past year. Which chart, and why not a pie chart?`,
        },
        {
          title: 'Your first linear model',
          summary: 'Fit a line, interpret slope and intercept, and spot when a line is the wrong tool.',
          format: 'READING',
          difficulty: 4,
          durationMinutes: 16,
          topics: ['modeling', 'statistics'],
          content: `## Your first linear model

A linear model predicts an outcome *y* from an input *x*: **y = a + b·x**.

- **Slope b**: the expected change in *y* for a one-unit increase in *x*.
- **Intercept a**: the predicted *y* when *x* = 0 (often not meaningful on its own).

Least squares picks *a* and *b* to minimize the sum of squared prediction errors.

**Correlation is not causation**: a strong fit shows association, not that *x* causes *y*.`,
        },
        {
          title: 'Evaluating models',
          summary: 'Train/test splits, overfitting and choosing a metric.',
          format: 'READING',
          difficulty: 4,
          durationMinutes: 14,
          topics: ['modeling'],
          content: `## Evaluating models

Always evaluate on data the model **has not seen**. Split into *training* and *test* sets.

- **Overfitting**: great on training data, poor on new data. The model memorized noise.
- **Underfitting**: poor everywhere. The model is too simple.

Pick a metric that matches the decision: accuracy is misleading when one class is rare; prefer precision/recall there.`,
        },
      ],
    },
  ],
  exams: [
    {
      title: 'Checkpoint: Probability & Statistics',
      description: 'Covers modules 1–2. Proctored: webcam and focus monitoring are used as review signals only.',
      durationMinutes: 20,
      proctored: true,
      passingScore: 60,
      questions: [
        {
          prompt: 'Which summary is most robust to a few extreme outliers?',
          options: ['Mean', 'Median', 'Range', 'Maximum'],
          correct: [1],
          topic: 'statistics',
          difficulty: 2,
          explanation: 'The median depends only on the middle value, so extreme values barely move it.',
        },
        {
          prompt: 'A survey rating (poor, fair, good, excellent) is which type of data?',
          options: ['Continuous numerical', 'Discrete numerical', 'Nominal categorical', 'Ordinal categorical'],
          correct: [3],
          topic: 'data-literacy',
          difficulty: 1,
          explanation: 'The categories have a natural order but unequal gaps: ordinal.',
        },
        {
          prompt: 'Two fair coins are flipped. What is P(both heads)?',
          options: ['0.5', '0.25', '0.75', '1.0'],
          correct: [1],
          topic: 'probability',
          difficulty: 2,
          explanation: 'Independent events multiply: 0.5 × 0.5 = 0.25.',
        },
        {
          prompt: 'If P(A) = 0.3, what is P(not A)?',
          options: ['0.3', '0.6', '0.7', 'Cannot be determined'],
          correct: [2],
          topic: 'probability',
          difficulty: 1,
          explanation: 'Complement rule: 1 − 0.3 = 0.7.',
        },
        {
          prompt: 'Incomes in a city are right-skewed. Which is true?',
          options: ['Mean < median', 'Mean > median', 'Mean = median', 'Skew does not affect the mean'],
          correct: [1],
          topic: 'statistics',
          difficulty: 3,
          explanation: 'A long right tail of large values pulls the mean above the median.',
        },
        {
          prompt: 'For roughly normal data, about what share lies within 2 standard deviations of the mean?',
          options: ['50%', '68%', '95%', '99.7%'],
          correct: [2],
          topic: 'probability',
          difficulty: 3,
          explanation: 'The 68–95–99.7 rule: ~95% within 2 SD.',
        },
        {
          prompt: 'An online poll about internet usage mostly reaches frequent internet users. This is an example of:',
          options: ['Survivorship bias', 'Selection bias', 'Overfitting', 'Measurement error'],
          correct: [1],
          topic: 'critical-thinking',
          difficulty: 2,
          explanation: 'Who gets sampled is systematically different from the population: selection bias.',
        },
        {
          prompt: 'Which of these are good, answerable data questions? (Select all that apply)',
          options: [
            'Are users happy?',
            'What share of new users return within 7 days?',
            'Did median page load time drop after the March release?',
            'Is our product the best?',
          ],
          correct: [1, 2],
          topic: 'data-literacy',
          difficulty: 2,
          explanation: 'Answerable questions name a measurement and a comparison.',
        },
      ],
    },
    {
      title: 'Quick Quiz: Visualization',
      description: 'A short practice quiz. Not proctored.',
      durationMinutes: 10,
      proctored: false,
      passingScore: 60,
      questions: [
        {
          prompt: 'Which chart best shows change over time?',
          options: ['Pie chart', 'Line chart', 'Histogram', 'Scatter plot'],
          correct: [1],
          topic: 'visualization',
          difficulty: 1,
          explanation: 'Line charts connect ordered time points, making trends visible.',
        },
        {
          prompt: 'Why should bar charts start at zero?',
          options: [
            'It looks cleaner',
            'Bar length encodes the value, so truncation exaggerates differences',
            'Software requires it',
            'Zero is the mean',
          ],
          correct: [1],
          topic: 'visualization',
          difficulty: 2,
          explanation: 'Readers compare bar lengths; a truncated axis distorts ratios.',
        },
        {
          prompt: 'To show the relationship between study hours and exam score, use a:',
          options: ['Scatter plot', 'Pie chart', 'Bar chart of averages', 'Table only'],
          correct: [0],
          topic: 'visualization',
          difficulty: 2,
          explanation: 'Two numerical variables → scatter plot.',
        },
        {
          prompt: 'In y = a + b·x, what does b represent?',
          options: [
            'The value of y when x = 0',
            'The expected change in y per unit increase in x',
            'The correlation',
            'The error term',
          ],
          correct: [1],
          topic: 'modeling',
          difficulty: 3,
          explanation: 'b is the slope.',
        },
        {
          prompt: 'A model scores 99% on training data but 60% on test data. This suggests:',
          options: ['Underfitting', 'Overfitting', 'A perfect model', 'Selection bias'],
          correct: [1],
          topic: 'modeling',
          difficulty: 3,
          explanation: 'Large train/test gap = memorized noise = overfitting.',
        },
      ],
    },
  ],
};

export const writingCourse: SeedCourse = {
  title: 'Academic Writing Essentials',
  description: 'Structure arguments, use evidence well and revise with purpose.',
  level: 'BEGINNER',
  tags: ['writing', 'communication'],
  accent: 'emerald',
  published: true,
  modules: [
    {
      title: 'Building an Argument',
      description: 'Claims, evidence and reasoning.',
      lessons: [
        {
          title: 'Thesis statements that work',
          summary: 'Make a specific, arguable claim.',
          format: 'READING',
          difficulty: 1,
          durationMinutes: 9,
          topics: ['writing'],
          content: `## Thesis statements that work

A strong thesis is **specific**, **arguable** and **scoped**.

- Weak: *Social media affects teenagers.*
- Strong: *Daily use of image-centric social media above two hours is associated with lower self-reported sleep quality among 14–17 year-olds.*`,
        },
        {
          title: 'Using evidence',
          summary: 'Choose, introduce and interpret sources.',
          format: 'VIDEO',
          difficulty: 2,
          durationMinutes: 12,
          topics: ['writing', 'critical-thinking'],
          content: `## Using evidence (video transcript)

Evidence doesn't speak for itself. Use the **quote sandwich**: introduce the source, present the evidence, then explain how it supports your claim.`,
        },
      ],
    },
    {
      title: 'Revision',
      description: 'From draft to final.',
      lessons: [
        {
          title: 'Reverse outlining',
          summary: 'Check structure by outlining what you actually wrote.',
          format: 'INTERACTIVE',
          difficulty: 2,
          durationMinutes: 10,
          topics: ['writing'],
          content: `## Reverse outlining

After drafting, write one sentence per paragraph summarizing its point. If the sentences don't form a logical sequence, reorganize before polishing sentences.`,
        },
        {
          title: 'Clarity at the sentence level',
          summary: 'Cut clutter, prefer active voice, keep subjects and verbs close.',
          format: 'READING',
          difficulty: 3,
          durationMinutes: 11,
          topics: ['writing'],
          content: `## Clarity at the sentence level

- Put the **actor** as the subject and the **action** as the verb.
- Cut words that don't change meaning (*in order to* → *to*).
- Keep subject and verb close together.`,
        },
      ],
    },
  ],
  exams: [],
};

export const mlDraftCourse: SeedCourse = {
  title: 'Machine Learning in Practice',
  description: 'Draft course: supervised learning end to end.',
  level: 'INTERMEDIATE',
  tags: ['machine-learning'],
  accent: 'amber',
  published: false,
  modules: [
    {
      title: 'Supervised Learning',
      description: 'Classification and regression.',
      lessons: [
        {
          title: 'Classification vs regression',
          summary: 'Predicting categories vs quantities.',
          format: 'READING',
          difficulty: 3,
          durationMinutes: 10,
          topics: ['modeling'],
          content: '## Classification vs regression\n\nDraft lesson.',
        },
      ],
    },
  ],
  exams: [],
};

export const summitCourse: SeedCourse = {
  title: 'Introduction to Economics',
  description: 'Supply, demand and the choices that shape markets.',
  level: 'BEGINNER',
  tags: ['economics'],
  accent: 'rose',
  published: true,
  modules: [
    {
      title: 'Markets',
      description: 'How prices form.',
      lessons: [
        {
          title: 'Supply and demand',
          summary: 'The two curves behind every price.',
          format: 'READING',
          difficulty: 1,
          durationMinutes: 10,
          topics: ['economics'],
          content: '## Supply and demand\n\nPrices settle where the quantity supplied equals the quantity demanded.',
        },
        {
          title: 'Elasticity',
          summary: 'How strongly quantity responds to price.',
          format: 'VIDEO',
          difficulty: 2,
          durationMinutes: 12,
          topics: ['economics'],
          content: '## Elasticity\n\nElastic goods see large quantity changes for small price changes.',
        },
      ],
    },
  ],
  exams: [],
};

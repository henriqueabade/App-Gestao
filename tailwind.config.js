module.exports = {
  content: [
    './src/login/**/*.html',
    './src/login/**/*.js',
    './src/html/**/*.html',
    './src/js/**/*.js',
    './src/styles/**/*.css'
  ],
  theme: {
    extend: {}
  },
  plugins: [
    require('@tailwindcss/forms')
  ]
};

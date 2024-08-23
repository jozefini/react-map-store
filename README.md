# React State Management Store

A lightweight and flexible state management solution for React applications, built with TypeScript. This store offers a simple API for managing complex state structures, including nested objects and arrays, with full TypeScript support.

## Key Features

- **TypeScript Support**: Fully typed for improved developer experience and code reliability.
- **Nested State Management**: Easily handle complex state structures with dot notation and array indexing.
- **React Hooks Integration**: Seamlessly integrate with React components using custom hooks.
- **Redux DevTools Support**: Built-in integration with Redux DevTools for easy debugging.
- **Batch Updates**: Efficiently update multiple state items in a single operation.
- **Fallback Values**: Define default values for state items that haven't been explicitly set.
- **Flexible Store Types**: Support for both map-based and object-based stores.
- **Subscription System**: Fine-grained subscriptions for optimal performance.

## Use Cases

- Global state management in React applications
- Complex form state handling
- Data caching and synchronization
- Any scenario requiring shared state across multiple components

This store provides a balance between the simplicity of React's built-in state management and the power of more complex state management libraries. It's ideal for projects that need more flexibility than React's Context API but don't require the full complexity of libraries like Redux.

## Getting Started

```typescript
import { CreateStore } from '@codesync/store'

type StoreStates = {
  user: {
    name: string
    roles: string[]
  }
}

const store = new CreateStore<StoreStates>({
  devtools: true,
  name: 'MyStore',
  initialMap: new Map([
    ['user', { name: 'John Doe', roles: [] }],
  ]),
  type: 'object',
})

// In your component:
const UserName = () => {
  const name = store.use(['user', 'name'])
  return <div>Name: {name}</div>
}
```

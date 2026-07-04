import { Component, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: `
    <nav>CRM Portal v{{ version() }}</nav>
    <router-outlet />
  `
})
export class AppComponent {
  version = signal('1.0.0');
  currentUser = signal<string | null>(null);
  isLoggedIn = computed(() => this.currentUser() !== null);

  constructor() {
    effect(() => {
      console.log('User changed:', this.currentUser());
    });
  }
}

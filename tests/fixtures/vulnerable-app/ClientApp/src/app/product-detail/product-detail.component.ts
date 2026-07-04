import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Product {
  id: number;
  name: string;
  description: string; // raw HTML sourced from user submissions
}

// VULN-006: XSS via [innerHTML] binding (CWE-79)
// `product.description` contains user-submitted content that has not been
// sanitised. Angular's DomSanitizer is bypassed because no sanitization is
// applied before binding. A stored-XSS payload in description will execute.
@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h2>{{ product.name }}</h2>
    <div [innerHTML]="product.description"></div>
  `,
})
export class ProductDetailComponent {
  @Input() product!: Product;
}

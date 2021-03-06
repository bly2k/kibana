Fork of Kibana 3 for Advanced Analytics

Examples:

![Example 1](/example1.jpg?raw=true)

![Example 2](/example2.jpg?raw=true)

Tutorial here:

http://hibalo.com/blog/post/2013/08/11/Visual-Analytics-with-Elasticsearch-and-Kibana.aspx

General:

- Performance improvements for histogram, terms, etc. panel queries
- Support for additional query options: None, Index
- Each panel can have its own independent querystring filter (no need to predefine and/or pin any queries up-front)

Terms Panel:

- Support terms/stats
- Support friendly labels
- Support term/value script
- Support filter field (i.e. when you click a term, you can specify a different field to filter against)
- Support multiple fields (comma separated) for terms/count
- Support dropdown style

Histogram Panel:

- Support mutiple/stacked histogram statistics (for example, plot average field X vs max field Y vs total field Z)
- Support friendly labels/aliases

Table Panel:

- Support friendly column header/labels

Stats Panel

- Support statistical facet
- Support distinct count of terms
- Support hit count using any query criteria

Stacked Stats Panel:

- Supports ability to stack individual statistics against each other using Bar, Pie, or Table
- Can define a ratio using 2 metrics
- Can define a percentage using 2 metrics

Table Stats Panel:

- Supports ability to display terms against multiple numeric variable statistics in a tabular format
- Supports sorting on any numeric variable/statistic

Bettermap Panel:

- Support specifying individual long,lat fields. No need to ingest lat longs in specific GeoIP array/format.

Query Panel:

- Support ability to convert any query string into a filter


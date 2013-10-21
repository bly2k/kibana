define([
  'angular',
  'app',
  'underscore',
  'jquery',
  'kbn'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.tablestats', []);
  app.useModule(module);

  module.controller('tablestats', function($scope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status: "Stable",
      description: "Displays a table of statistical aggregrations (count, total, avg, max, min, terms/distinct count, hits) grouped by a terms field."
    };

    var _d = {
      queries: {
        mode: 'all',
        ids: []
      },
      style   : { "font-size": '10pt'},
      stackCharts : [], //array of { statistic: "count", field: "", alias: "", queryString: "", valueScript: "" }
      decimals: 0,
      decimalSeparator: ".",
      commaSeparator: ",",
      size: 10,
      formatString: "{0}",
      spyable : true,
      field: null,
      alias: null,
      sort: {
        field: "",
        order: "",
        chartIndex: 0
      }
    };

    _.defaults($scope.panel, _d);

    $scope.set_refresh = function (state)
    {
      $scope.refresh = state;
    };

    $scope.close_edit = function ()
    {
      if ($scope.refresh)
      {
        $scope.get_data();
      }
      $scope.refresh = false;
      $scope.$emit('render');
    };

    $scope.init = function ()
    {
      $scope.$on('render', function ()
      {
        $scope.$apply();
      });
      $scope.$on('refresh', function ()
      {
        $scope.get_data();
      });
      $scope.get_data();
    };

    $scope.addStackChart = function() {
      $scope.panel.stackCharts.push({ statistic: "count", field: "", alias: "", queryString: "", valueScript: "" });
      $scope.setSort(-1);
      $scope.set_refresh(true);
    }

    $scope.setSort = function(chartIndex) {
      if (chartIndex < 0) {
        $scope.panel.sort.field = "";
        $scope.panel.sort.order = "";
        $scope.panel.sort.chartIndex = 0;
        return;
      }

      var currentSort = $scope.getSortParams();
      if (chartIndex == currentSort.chartIndex) {
        currentSort.order = currentSort.order.match(/reverse_.*/) ? currentSort.order.replace(/reverse_/, "") : "reverse_" + currentSort.order;
      }
      else {
        var chart = $scope.panel.stackCharts[chartIndex];
        $scope.panel.sort.field = chart.field;
        $scope.panel.sort.order = chart.statistic;
        $scope.panel.sort.chartIndex = chartIndex;
      }
      $scope.get_data();
    }

    $scope.buildSearch = function (term, mandate) {
      if (_.isUndefined(mandate)) mandate = "must";
      var filterField = $scope.panel.field;
      filterSrv.set({ type:'terms', field:filterField, value:term, mandate: mandate });
      dashboard.refresh();
    }

    $scope.getSortParamsOrder = function() {
      var sort = $scope.getSortParams();
      if (sort == null) return null;
      return sort.order.match(/reverse_.*/) ? "asc": "desc";
    }

    $scope.getSortParams = function() {
      var sort = $scope.panel.sort;
      if ($scope.panel.stackCharts.length <= 0) return null;

      if ($scope.panel.sort.field == null || $scope.panel.sort.field == "" || 
        $scope.panel.sort.order == null || $scope.panel.sort.order == "") {

        var chart = $scope.panel.stackCharts[0];
        $scope.panel.sort.field = chart.field;
        $scope.panel.sort.order = chart.statistic;
        $scope.panel.sort.chartIndex = 0;
      }

      return $scope.panel.sort;
    }

    $scope.buildSecondaryFacets = function(primary, sort) {
      var request = $scope.ejs.Request().indices(dashboard.indices);

      var terms = _.map(primary.facets[sort.chartIndex.toString()].terms, function(term) { return term.term } );

      var fq = querySrv.getQueryFilterParts(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);
      fq.filter = fq.filter.must($scope.ejs.TermsFilter($scope.panel.field, terms));
      
      request = request.query($scope.ejs.FilteredQuery(fq.query, fq.filter));

      for (var c = 0; c < $scope.panel.stackCharts.length; c++) {
        var chart = $scope.panel.stackCharts[c];
        
        var facetFilter = null;
        if (!_.isUndefined(chart.queryString) && !_.isNull(chart.queryString) && chart.queryString != "") 
          facetFilter = querySrv.getFacetFilter(filterSrv, $scope.panel.queries, [$scope.panel.queries.queryString, chart.queryString]);

        if (c != sort.chartIndex) {
          var facet = $scope.ejs.TermStatsFacet(c.toString())
            .keyField($scope.panel.field)
            .size($scope.panel.size)
            .order("term");

          if (facetFilter != null) facet = facet.facetFilter(facetFilter);

          if (chart.valueScript != null && chart.valueScript != "")
            facet = facet.valueScript(chart.valueScript);
          else
            facet = facet.valueField(chart.field);

          request = request.facet(facet).size(0);
        }
      }

      return request;
    }

    $scope.getSecondaryStatistic = function(secondary, facetId, term, statistic) {
      var terms = secondary.facets[facetId].terms;
      var item = _.findWhere(terms, { term: term });
      return item != null ? item[statistic] : null;
    }

    $scope.getTermAlias = function() {
      if ($scope.panel.alias == null || $scope.panel.alias == "")
        return $scope.panel.field;
      else
        return $scope.panel.alias;
    }

    $scope.getStatisticAlias = function(chartIndex) {
      var chart = $scope.panel.stackCharts[chartIndex];
      if (chart.alias == null || chart.alias == "")
        return chart.statistic + " " + chart.field;
      else
        return chart.alias;
    }

    $scope.get_data = function (segment, query_id)
    {
      delete $scope.panel.error;
      delete $scope.data;

      // Make sure we have everything for the request to complete
      if (dashboard.indices.length === 0 || $scope.panel.stackCharts.length <= 0) {
        return;
      }

      if ($scope.panel.field == null || $scope.panel.field == null || $scope.panel.field == "") {
        $scope.panel.error = "Terms field must be specified";
        return;
      }

      $scope.panelMeta.loading = true;

      var request = $scope.ejs.Request().indices(dashboard.indices);

      var sort = $scope.getSortParams();
      if (sort == null) return;

      var primaryChart = $scope.panel.stackCharts[sort.chartIndex];

      var fq = querySrv.getFacetQuery(filterSrv, $scope.panel.queries, [$scope.panel.queries.queryString, primaryChart.queryString]);
      request = request.query(fq);

      var facet = $scope.ejs.TermStatsFacet(sort.chartIndex.toString())
        .keyField($scope.panel.field)
        .size($scope.panel.size)
        .order(sort.order);

      if (primaryChart.valueScript != null && primaryChart.valueScript != "")
        facet = facet.valueScript(primaryChart.valueScript);
      else
        facet = facet.valueField(sort.field);

      request = request.facet(facet).size(0);

      var primaryRequest = request;
      //$scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      var results = request.doSearch();

      results.then(function (results) {
        $scope.results = results;
        request = $scope.buildSecondaryFacets(results, sort);

        $scope.inspector = 
          angular.toJson(JSON.parse(primaryRequest.toString()),true) + "\r\n\r\n---\r\n\r\n" +
          angular.toJson(JSON.parse(request.toString()),true);

        results = request.doSearch();

        results.then(function (results) {
          $scope.panelMeta.loading = false;

          $scope.secondaryResults = results;

          require(['jquery.number'], function() {
            $scope.data = [];  //rows

            results = $scope.results; // restore primary results!

            var i = 0;
            _.each(results.facets[sort.chartIndex.toString()].terms, function (term) {
              var row = [term.term];

              for (var c = 0; c < $scope.panel.stackCharts.length; c++) {
                var chart = $scope.panel.stackCharts[c];

                var stat = c == sort.chartIndex ? term[chart.statistic] : 
                  $scope.getSecondaryStatistic($scope.secondaryResults, c.toString(), term.term, chart.statistic);

                var formatted = $.number(stat, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
                if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != null && $scope.panel.formatString != "")
                  formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);

                row.push(formatted);
              }

              $scope.data.push(row);
              i++;
            });

            $scope.$emit('render');
          });
        });
      });
    };
  });

});